import * as Discord from "discord.js";
import * as Postgres from "pg";
import * as Gravatar from "gravatar";
import {randomInt} from "crypto";


async function connectWebhook() {
    console.debug("Connecting to the webhook...")
    return new Discord.WebhookClient({
        id: process.env.DISCORD_WEBHOOK_ID,
        token: process.env.DISCORD_WEBHOOK_TOKEN,
    })
}


async function connectDatabase() {
    console.debug("Connecting to the database...")
    const client = new Postgres.Client({
        user: "steffo",
        database: "ryg-backup",
        port: 5432,
        host: "localhost",
    })
    await client.connect()
    return client
}


interface DiarioLike {
    diario_id: number,
    creator_id: number | null,
    quoted_account_id: number | null,
    quoted: string | null,
    text: string | null,
    context: string | null,
    timestamp: Date,
    media_url: string | null,
    spoiler: boolean,
    discord_id: number | null,
}

interface UserLike {
    uid: number,
    username: string,
}

type UsersMap = {[key: string]: string}


class Diario {
    obj: DiarioLike

    constructor(d: DiarioLike) {
        this.obj = d
    }

    shouldWrapInQuotes(): boolean {
        if(!this.obj.text) return false
        if(this.obj.text.includes(`"`)) return false
        if(this.obj.text.includes(`|`)) return false
        if(this.obj.text.includes(`:`)) return false
        return true
    }

    shouldSendAsDescription(): boolean {
        if(!this.obj.text) return false
        if(this.obj.spoiler) return true
        if(this.obj.text.length > 250) return true
        return false
    }

    getText(): string | undefined {
        if(!this.obj.text) return undefined
        if(this.obj.spoiler) return `||${this.obj.text}||`
        if(this.shouldWrapInQuotes()) return `"${this.obj.text}"`
        return this.obj.text
    }

    makeTitle(): string | undefined {
        if(this.shouldSendAsDescription()) return undefined
        return this.getText()
    }

    makeDescription(): string | undefined {
        if(this.shouldSendAsDescription()) {
            if(this.obj.context) return `${this.getText()}\n_${this.obj.context}_`
            return this.getText()
        }
        else {
            if(this.obj.context) return `_${this.obj.context}_`
            return undefined
        }
    }

    makeUrl(): string | undefined {
        return undefined
    }

    makeTimestamp(): Date | undefined {
        return this.obj.timestamp
    }

    makeColor(): Discord.ColorResolvable {
        if(this.obj.spoiler) return "#ff7f7f"
        return "#7fff7f"
    }

    makeFields(): Discord.EmbedFieldData[] {
        return []
    }

    makeAuthor(users: UsersMap): Partial<Discord.MessageEmbedAuthor> | undefined {
        let username: string | undefined = undefined

        if(this.obj.quoted_account_id) {
            username = users[this.obj.quoted_account_id].toLowerCase()
        }
        else if(this.obj.quoted) {
            username = Object.values(users).find(val => val === this.obj.quoted.toLowerCase())
        }

        if(username) {
            return {
                name: username,
                iconURL: Gravatar.url(`${username}@ryg.one`, {
                    "default": "identicon",
                    protocol: "https",
                })
            }
        }
        else if(this.obj.quoted) {
            return {
                name: this.obj.quoted.toLowerCase(),
                iconURL: Gravatar.url(``, {
                    "default": "mp",
                    forcedefault: "true",
                    protocol: "https",
                })
            }
        }
        else {
            return undefined
        }
    }

    makeThumbnail(): Partial<Discord.MessageEmbedThumbnail> | undefined {
        return undefined
    }

    makeImage(): Partial<Discord.MessageEmbedImage> | undefined {
        if(this.obj.text?.startsWith("https://i.imgur.com/")) {
            try {
                const url = new URL(this.obj.text)
                return {
                    url: url.toString(),
                }
            }
            catch(e) {
                console.warn("Invalid image URL")
                return undefined
            }
        }

        if(this.obj.media_url) {
            return {
                url: this.obj.media_url,
            }
        }
        else return undefined
    }

    makeVideo(): Partial<Discord.MessageEmbedVideo> | undefined {
        return undefined
    }

    makeFooter(): Partial<Discord.MessageEmbedFooter> | undefined {
        return {
            text: `#${this.obj.diario_id}`,
        }
    }

    makeEmbed(users: UsersMap): Discord.MessageEmbed {
        return new Discord.MessageEmbed({
            title: this.makeTitle(),
            description: this.makeDescription(),
            url: this.makeUrl(),
            timestamp: this.makeTimestamp(),
            color: this.makeColor(),
            fields: this.makeFields(),
            author: this.makeAuthor(users),
            thumbnail: this.makeThumbnail(),
            image: this.makeImage(),
            video: this.makeVideo(),
            footer: this.makeFooter(),
        })
    }

    makeSenderUsername(users: UsersMap): string | undefined {
        if(this.obj.creator_id) {
            const username = users[this.obj.creator_id].toLowerCase()
            return username
        }
        return "anonimo"
    }

    makeSenderImage(users: UsersMap): string | undefined {
        if(this.obj.creator_id) {
            const username = users[this.obj.creator_id].toLowerCase()
            return Gravatar.url(`${username}@ryg.one`, {
                "default": "identicon",
                protocol: "https",
            })
        }
        return Gravatar.url(``, {
            "default": "mp",
            forcedefault: "true",
            protocol: "https",
        })
    }
}


async function fetchUsers(database: Postgres.Client): Promise<UsersMap> {
    console.debug("Fetching users...")
    const raw = await database.query<UserLike>("SELECT uid, username FROM users")
    return raw.rows.map(r => {
        const obj: UsersMap = {}
        obj[r.uid] = r.username
        return obj
    }).reduce((a, b) => {
        return {...a, ...b}
    })
}


async function fetchEntries(database: Postgres.Client): Promise<Diario[]> {
    console.debug("Fetching diario entries...")
    const raw = await database.query("SELECT * FROM diario ORDER BY diario_id")
    const array = raw.rows
    return array.map(r => new Diario(r))
}


async function main() {
    const webhook = await connectWebhook()
    const database = await connectDatabase()

    const users = await fetchUsers(database)
    const entries = await fetchEntries(database)

    for(const entry of entries) {
        if(entry.obj.diario_id <= 5009) continue

        console.info("Entry: #", entry.obj.diario_id)

        console.debug("Sending...")
        const message = await webhook.send({
            embeds: [entry.makeEmbed(users)],
            username: entry.makeSenderUsername(users),
            avatarURL: entry.makeSenderImage(users),
        })

        console.debug("Storing...")
        await database.query("UPDATE diario SET discord_id = $1 WHERE diario_id = $2", [message.id, entry.obj.diario_id])

        console.debug("Waiting...")
        await new Promise(resolve => setTimeout(resolve, 2250))
    }
}


main().finally(
    () => {
        console.log("Main has exited.")
    }
)