import { Injectable } from "@nestjs/common";
import { isUserRelated } from "@/misc/is-user-related.js";
import type { Packed } from "@/misc/json-schema.js";
import { NoteEntityService } from "@/core/entities/NoteEntityService.js";
import { bindThis } from "@/decorators.js";
import Channel from "../channel.js";
import { StreamMessages } from "../types.js";
import { RoleService } from "@/core/RoleService.js";

class RoleTimelineChannel extends Channel {
	public readonly chName = "roleTimeline";
	public static shouldShare = false;
	public static requireCredential = false as const;
	private roleId: string;
	private minimize: boolean;

	constructor(
		private noteEntityService: NoteEntityService,
		private roleservice: RoleService,

		id: string,
		connection: Channel["connection"],
	) {
		super(id, connection);
		//this.onNote = this.onNote.bind(this);
	}

	@bindThis
	public async init(params: any) {
		this.roleId = params.roleId as string;
		this.minimize = params.minimize as boolean;

		this.subscriber.on(`roleTimelineStream:${this.roleId}`, this.onEvent);
	}

	@bindThis
	private async onEvent(data: StreamMessages["roleTimeline"]["payload"]) {
		if (data.type === "note") {
			const note = data.body;

			if (!(await this.roleservice.isExplorable({ id: this.roleId }))) {
				return;
			}
			if (note.visibility !== "public") return;

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
					poll: note.poll ? { choices: note.poll.choices } : undefined,
					reply: note.reply ? { myReaction: note.reply.myReaction } : undefined,
					renote: note.renote ? { myReaction: note.renote.myReaction } : undefined,
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
		this.subscriber.off(`roleTimelineStream:${this.roleId}`, this.onEvent);
	}
}

@Injectable()
export class RoleTimelineChannelService {
	public readonly shouldShare = RoleTimelineChannel.shouldShare;
	public readonly requireCredential = RoleTimelineChannel.requireCredential;
	public readonly kind = RoleTimelineChannel.kind;

	constructor(
		private noteEntityService: NoteEntityService,
		private roleservice: RoleService,
	) {}

	@bindThis
	public create(
		id: string,
		connection: Channel["connection"],
	): RoleTimelineChannel {
		return new RoleTimelineChannel(
			this.noteEntityService,
			this.roleservice,
			id,
			connection,
		);
	}
}
