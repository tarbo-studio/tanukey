import type { IdService } from "@/core/IdService.js";
import type { QueryService } from "@/core/QueryService.js";
import type ActiveUsersChart from "@/core/chart/charts/active-users.js";
import type { NoteEntityService } from "@/core/entities/NoteEntityService.js";
import { DI } from "@/di-symbols.js";
import type { SearchService } from "@/core/SearchService.js";
import type {
	Antenna,
	AntennasRepository,
	ChannelsRepository,
	UsersRepository,
	NotesRepository,
} from "@/models/index.js";
import { Endpoint } from "@/server/api/endpoint-base.js";
import { Inject, Injectable } from "@nestjs/common";
import { ApiError } from "../../error.js";
import * as Acct from "@/misc/acct.js";
import { IsNull } from "typeorm";

export const meta = {
	tags: ["notes", "channels"],

	requireCredential: false,

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
		noSuchChannel: {
			message: "No such channel.",
			code: "NO_SUCH_CHANNEL",
			id: "4d0eeeba-a02c-4c3c-9966-ef60d38d2e7f",
		},
	},
} as const;

export const paramDef = {
	type: "object",
	properties: {
		channelId: { type: "string", format: "misskey:id" },
		limit: { type: "integer", minimum: 1, maximum: 100, default: 10 },
		sinceId: { type: "string", format: "misskey:id" },
		untilId: { type: "string", format: "misskey:id" },
		sinceDate: { type: "integer" },
		untilDate: { type: "integer" },
		idOnly: { type: 'boolean', default: false },
	},
	required: ["channelId"],
} as const;

// eslint-disable-next-line import/no-default-export
@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(
		@Inject(DI.antennasRepository)
		private antennasRepository: AntennasRepository,

		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		@Inject(DI.channelsRepository)
		private channelsRepository: ChannelsRepository,

		@Inject(DI.idService)
		private idService: IdService,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.searchService)
		private searchService: SearchService,

		@Inject(DI.noteEntityService)
		private noteEntityService: NoteEntityService,

		@Inject(DI.queryService)
		private queryService: QueryService,

		@Inject(DI.activeUsersChart)
		private activeUsersChart: ActiveUsersChart,
	) {
		super(meta, paramDef, async (ps, me) => {
			const channel = await this.channelsRepository.findOneBy({
				id: ps.channelId,
			});

			if (channel == null) {
				throw new ApiError(meta.errors.noSuchChannel);
			}

			const filters: any[] = [];

			const channelFilter = await this.searchService.getFilter("", {
				origin: "local",
				channelId: ps.channelId,
				includeReplies: true,
			});

			filters.push(channelFilter);

			if (channel.tags.length > 0) {
				const tagsFilter = await this.searchService.getFilter("", {
					origin: "local",
					tags: channel.tags.map((tag) => tag.trim().replaceAll("#", "")),
				});

				filters.push(tagsFilter);
			}

			const notes = await this.searchService.searchNoteWithFilter(
				me,
				filters,
				{
					checkChannelSearchable: false,
					reverseOrder: false,
				},
				{
					untilId: ps.untilId,
					sinceId: ps.sinceId,
					limit: ps.limit,
				},
			);

			if (me) this.activeUsersChart.read(me);

			return await this.noteEntityService.packMany(notes, me, undefined, ps.idOnly);
		});
	}
}
