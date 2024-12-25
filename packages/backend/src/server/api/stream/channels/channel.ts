import type { NoteEntityService } from "@/core/entities/NoteEntityService.js";
import { bindThis } from "@/decorators.js";
import { DI } from "@/di-symbols.js";
import { isUserRelated } from "@/misc/is-user-related.js";
import type { Packed } from "@/misc/json-schema.js";
import type { Channel as _Channel } from "@/models/entities/Channel.js";
import type { ChannelsRepository } from "@/models/index.js";
import { Inject, Injectable } from "@nestjs/common";
import Channel from "../channel.js";
import type { StreamMessages } from "../types.js";

class ChannelChannel extends Channel {
	public readonly chName = "channel";
	public static shouldShare = false;
	public static requireCredential = false as const;
	private channelId: string;
	private channel: _Channel | null;
	private minimize: boolean;

	constructor(
		private noteEntityService: NoteEntityService,
		private channelsRepository: ChannelsRepository,

		id: string,
		connection: Channel["connection"],
	) {
		super(id, connection);
	}

	@bindThis
	public async init(params: any) {
		this.channelId = params.channelId as string;
		this.channel = await this.channelsRepository.findOne({
			where: {
				id: this.channelId,
			},
		});
		this.minimize = params.minimize as boolean;

		this.subscriber.on("notesStream", this.onNote);
	}

	@bindThis
	private async onNote(note: Packed<"Note">) {
		if (note.channelId !== this.channelId) {
			if (!note.tags) {
				return;
			}

			if (!this.channel) return;

			// 収集はローカルのみ
			if (note.user.host !== null) {
				return;
			}

			// 収集タグと通知タグ両方該当しない場合
			const tags: string[] = this.channel.tags;
			const notificationTags: string[] = this.channel.notificationTags;
			if (
				note.tags.filter((item) => tags.includes(item)).length === 0 &&
				note.tags.filter((item) => notificationTags.includes(item)).length === 0
			) {
				return;
			}
		}

		// リプライなら再pack
		if (note.replyId != null) {
			note.reply = await this.noteEntityService.pack(note.replyId, this.user, {
				detail: true,
			});
		}
		// Renoteなら再pack
		if (note.renoteId != null) {
			note.renote = await this.noteEntityService.pack(
				note.renoteId,
				this.user,
				{
					detail: true,
				},
			);
		}

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
	}

	@bindThis
	public dispose() {
		// Unsubscribe events
		this.subscriber.off("notesStream", this.onNote);
	}
}

@Injectable()
export class ChannelChannelService {
	public readonly shouldShare = ChannelChannel.shouldShare;
	public readonly requireCredential = ChannelChannel.requireCredential;
	public readonly kind = ChannelChannel.kind;

	constructor(
		@Inject(DI.noteEntityService)
		private noteEntityService: NoteEntityService,

		@Inject(DI.channelsRepository)
		private channelsRepository: ChannelsRepository,
	) {}

	@bindThis
	public create(id: string, connection: Channel["connection"]): ChannelChannel {
		return new ChannelChannel(
			this.noteEntityService,
			this.channelsRepository,
			id,
			connection,
		);
	}
}
