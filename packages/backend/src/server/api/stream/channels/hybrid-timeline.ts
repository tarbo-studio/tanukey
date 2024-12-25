import { MetaService } from "@/core/MetaService.js";
import { RoleService } from "@/core/RoleService.js";
import { NoteEntityService } from "@/core/entities/NoteEntityService.js";
import { bindThis } from "@/decorators.js";
import { checkWordMute } from "@/misc/check-word-mute.js";
import { isInstanceMuted } from "@/misc/is-instance-muted.js";
import { isUserRelated } from "@/misc/is-user-related.js";
import type { Packed } from "@/misc/json-schema.js";
import { Injectable } from "@nestjs/common";
import Channel from "../channel.js";

class HybridTimelineChannel extends Channel {
	public readonly chName = "hybridTimeline";
	public static shouldShare = true;
	public static requireCredential = true;
	public static kind = "read:account";
	private withReplies: boolean;
	private withLocal: boolean;
	private withRemote: boolean;
	private withChannel: boolean;
	private minimize: boolean;

	constructor(
		private metaService: MetaService,
		private roleService: RoleService,
		private noteEntityService: NoteEntityService,

		id: string,
		connection: Channel["connection"],
	) {
		super(id, connection);
		//this.onNote = this.onNote.bind(this);
	}

	@bindThis
	public async init(params: any): Promise<void> {
		const policies = await this.roleService.getUserPolicies(
			this.user ? this.user.id : null,
		);
		if (!policies.ltlAvailable) return;

		this.withReplies = params.withReplies as boolean;
		this.withLocal = params.withLocal as boolean;
		this.withRemote = params.withRemote as boolean;
		this.withChannel = params.withChannel as boolean;
		this.minimize = params.minimize as boolean;

		// Subscribe events
		this.subscriber.on("notesStream", this.onNote);
	}

	@bindThis
	private async onNote(note: Packed<"Note">) {
		// チャンネルの投稿ではなく、自分自身の投稿 または
		// チャンネルの投稿ではなく、その投稿のユーザーをフォローしている または
		// チャンネルの投稿ではなく、全体公開のローカルの投稿 または
		// フォローしているチャンネルの投稿 の場合だけ
		if (
			!(
				(note.channelId == null && this.user!.id === note.userId) ||
				(note.channelId == null && this.following.has(note.userId)) ||
				(note.channelId == null &&
					note.user.host == null &&
					note.visibility === "public") ||
				(note.channelId != null && this.followingChannels.has(note.channelId))
			)
		) {
			return;
		}

		// ローカルを表示が無効の場合は、ローカルの投稿は除外
		if (!this.withLocal) {
			if (note.user.host == null && !note.channelId) {
				return;
			}
		}

		// リモートユーザーを表示が無効の場合は、リモートユーザーの投稿は除外
		if (!this.withRemote) {
			if (note.user.host !== null) {
				return;
			}
		}

		// チャンネルの表示が無効の場合は、チャンネルの投稿は除外
		if (!this.withChannel) {
			// パブリック投稿の場合にはchannelIdがundefinedになる
			if (note.channelId != null) {
				return;
			}
		}

		// DMはタイムラインに表示しない
		if (["specified"].includes(note.visibility)) {
			return;
		}

		if (["followers"].includes(note.visibility)) {
			note = await this.noteEntityService.pack(note.id, this.user!, {
				detail: true,
			});

			if (note.isHidden) {
				return;
			}
		} else {
			// リプライなら再pack
			if (note.replyId != null) {
				note.reply = await this.noteEntityService.pack(
					note.replyId,
					this.user!,
					{
						detail: true,
					},
				);
			}
			// Renoteなら再pack
			if (note.renoteId != null) {
				note.renote = await this.noteEntityService.pack(
					note.renoteId,
					this.user!,
					{
						detail: true,
					},
				);
			}
		}

		// Ignore notes from instances the user has muted
		if (
			isInstanceMuted(
				note,
				new Set<string>(this.userProfile!.mutedInstances ?? []),
			)
		)
			return;

		// 関係ない返信は除外
		if (note.reply && !this.withReplies) {
			const reply = note.reply;
			// 「チャンネル接続主への返信」でもなければ、「チャンネル接続主が行った返信」でもなければ、「投稿者の投稿者自身への返信」でもない場合
			if (
				reply.userId !== this.user!.id &&
				note.userId !== this.user!.id &&
				reply.userId !== note.userId
			)
				return;
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

		// 流れてきたNoteがミュートすべきNoteだったら無視する
		// TODO: 将来的には、単にMutedNoteテーブルにレコードがあるかどうかで判定したい(以下の理由により難しそうではある)
		// 現状では、ワードミュートにおけるMutedNoteレコードの追加処理はストリーミングに流す処理と並列で行われるため、
		// レコードが追加されるNoteでも追加されるより先にここのストリーミングの処理に到達することが起こる。
		// そのためレコードが存在するかのチェックでは不十分なので、改めてcheckWordMuteを呼んでいる
		if (
			this.userProfile &&
			(await checkWordMute(note, this.user, this.userProfile.mutedWords))
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
	public dispose(): void {
		// Unsubscribe events
		this.subscriber.off("notesStream", this.onNote);
	}
}

@Injectable()
export class HybridTimelineChannelService {
	public readonly shouldShare = HybridTimelineChannel.shouldShare;
	public readonly requireCredential = HybridTimelineChannel.requireCredential;
	public readonly kind = HybridTimelineChannel.kind;

	constructor(
		private metaService: MetaService,
		private roleService: RoleService,
		private noteEntityService: NoteEntityService,
	) {}

	@bindThis
	public create(
		id: string,
		connection: Channel["connection"],
	): HybridTimelineChannel {
		return new HybridTimelineChannel(
			this.metaService,
			this.roleService,
			this.noteEntityService,
			id,
			connection,
		);
	}
}
