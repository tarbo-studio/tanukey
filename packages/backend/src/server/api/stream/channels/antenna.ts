import { Injectable } from "@nestjs/common";
import { isUserRelated } from "@/misc/is-user-related.js";
import { NoteEntityService } from "@/core/entities/NoteEntityService.js";
import { bindThis } from "@/decorators.js";
import Channel from "../channel.js";
import type { StreamMessages } from "../types.js";

class AntennaChannel extends Channel {
	public readonly chName = "antenna";
	public static shouldShare = false;
	public static requireCredential = true as const;
	public static kind = "read:account";
	private antennaId: string;
	private minimize: boolean;

	constructor(
		private noteEntityService: NoteEntityService,

		id: string,
		connection: Channel["connection"],
	) {
		super(id, connection);
		//this.onEvent = this.onEvent.bind(this);
	}

	@bindThis
	public async init(params: any) {
		this.antennaId = params.antennaId as string;
		this.minimize = params.minimize as boolean;

		// Subscribe stream
		this.subscriber.on(`antennaStream:${this.antennaId}`, this.onEvent);
	}

	@bindThis
	private async onEvent(data: StreamMessages["antenna"]["payload"]) {
		if (data.type === "note") {
			const note = await this.noteEntityService.pack(data.body.id, this.user, {
				detail: true,
			});

			// 流れてきたNoteがミュートしているユーザーが関わるものだったら無視する
			if (isUserRelated(note, this.userIdsWhoMeMuting)) return;
			// 流れてきたNoteがブロックされているユーザーが関わるものだったら無視する
			if (isUserRelated(note, this.userIdsWhoBlockingMe)) return;

			if (
				note.renote &&
				!note.text &&
				isUserRelated(note, this.userIdsWhoMeMutingRenotes)
			)
				return;

			if (this.minimize && ['public', 'home'].includes(note.visibility)) {
				this.send('note', {
					id: note.id, myReaction: note.myReaction,
					poll: note.poll?.choices ? { choices: note.poll.choices } : undefined,
					reply: note.reply?.myReaction ? { myReaction: note.reply.myReaction } : undefined,
					renote: note.renote?.myReaction ? { myReaction: note.renote.myReaction } : undefined,
				});
			} else {
				this.connection.cacheNote(note);
				this.send("note", note);
			}
		} else {
			this.send(data.type, data.body);
		}
	}

	@bindThis
	public dispose() {
		// Unsubscribe events
		this.subscriber.off(`antennaStream:${this.antennaId}`, this.onEvent);
	}
}

@Injectable()
export class AntennaChannelService {
	public readonly shouldShare = AntennaChannel.shouldShare;
	public readonly requireCredential = AntennaChannel.requireCredential;
	public readonly kind = AntennaChannel.kind;

	constructor(private noteEntityService: NoteEntityService) {}

	@bindThis
	public create(id: string, connection: Channel["connection"]): AntennaChannel {
		return new AntennaChannel(this.noteEntityService, id, connection);
	}
}
