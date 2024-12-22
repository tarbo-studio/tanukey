import type { Config } from "@/config.js";
import type { SearchService } from "@/core/SearchService.js";
import type ActiveUsersChart from "@/core/chart/charts/active-users.js";
import type { NoteEntityService } from "@/core/entities/NoteEntityService.js";
import { DI } from "@/di-symbols.js";
import type {
	NotesRepository,
	UserListJoiningsRepository,
	UserListsRepository,
} from "@/models/index.js";
import { Endpoint } from "@/server/api/endpoint-base.js";
import { Inject, Injectable } from "@nestjs/common";
import { ApiError } from "../../error.js";

export const meta = {
	tags: ["notes", "lists"],

	requireCredential: true,
	kind: "read:account",

	res: {
		type: "array",
		optional: false,
		nullable: false,
		items: {
			type: "object",
			optional: false,
			nullable: false,
			ref: "Note",
		},
	},

	errors: {
		noSuchList: {
			message: "No such list.",
			code: "NO_SUCH_LIST",
			id: "8fb1fbd5-e476-4c37-9fb0-43d55b63a2ff",
		},
	},
} as const;

export const paramDef = {
	type: "object",
	properties: {
		listId: { type: "string", format: "misskey:id" },
		limit: { type: "integer", minimum: 1, maximum: 100, default: 10 },
		sinceId: { type: "string", format: "misskey:id" },
		untilId: { type: "string", format: "misskey:id" },
	},
	required: ["listId"],
} as const;

// eslint-disable-next-line import/no-default-export
@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(
		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		@Inject(DI.userListsRepository)
		private userListsRepository: UserListsRepository,

		@Inject(DI.userListJoiningsRepository)
		private userListJoiningsRepository: UserListJoiningsRepository,

		@Inject(DI.noteEntityService)
		private noteEntityService: NoteEntityService,

		@Inject(DI.searchService)
		private searchService: SearchService,

		@Inject(DI.activeUsersChart)
		private activeUsersChart: ActiveUsersChart,
	) {
		super(meta, paramDef, async (ps, me) => {
			const list = await this.userListsRepository.findOneBy({
				id: ps.listId,
				userId: me.id,
			});

			if (list == null) {
				throw new ApiError(meta.errors.noSuchList);
			}

			const userListJoinings = await userListJoiningsRepository.findBy({
				userListId: list.id,
			});

			const userIds = userListJoinings.map((u) => u.userId);
			const query = "";

			const notes = await this.searchService.searchNote(
				query,
				me,
				{
					userIds: userIds,
					checkChannelSearchable: true,
					reverseOrder: false,
				},
				{
					untilId: ps.untilId,
					sinceId: ps.sinceId,
					limit: ps.limit,
				},
			);

			this.activeUsersChart.read(me);

			return await this.noteEntityService.packMany(notes, me);
		});
	}
}
