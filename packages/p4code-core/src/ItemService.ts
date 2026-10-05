import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import {
  Item,
  ItemSummary,
  IssueComment,
  IssueUrl,
  ItemRequestError,
  ItemUnavailableError,
} from "@p4code/contracts/items";
import type { ProjectId } from "@t3tools/contracts";
import * as GitHubIssue from "./GitHubIssue.ts";

export class Projects extends Context.Service<
  Projects,
  {
    readonly exists: (projectId: ProjectId) => Effect.Effect<boolean, ItemUnavailableError>;
  }
>()("@p4code/core/ItemService/Projects") {}
export class ItemThreadLauncher extends Context.Service<
  ItemThreadLauncher,
  {
    readonly launch: (input: {
      readonly projectId: ProjectId;
      readonly title: string;
    }) => Effect.Effect<string, ItemUnavailableError>;
  }
>()("@p4code/core/ItemService/ItemThreadLauncher") {}
export class ItemThreadReader extends Context.Service<
  ItemThreadReader,
  {
    readonly isAvailable: (input: {
      readonly projectId: ProjectId;
      readonly threadId: string;
    }) => Effect.Effect<boolean, ItemUnavailableError>;
  }
>()("@p4code/core/ItemService/ItemThreadReader") {}
export class ItemService extends Context.Service<
  ItemService,
  {
    readonly list: (
      projectId: ProjectId,
    ) => Effect.Effect<ReadonlyArray<ItemSummary>, ItemRequestError | ItemUnavailableError>;
    readonly get: (
      projectId: ProjectId,
      itemId: string,
    ) => Effect.Effect<Item, ItemRequestError | ItemUnavailableError>;
    readonly refresh: (
      projectId: ProjectId,
      itemId: string,
    ) => Effect.Effect<Item, ItemRequestError | ItemUnavailableError>;
    readonly startThread: (
      projectId: ProjectId,
      itemId: string,
    ) => Effect.Effect<string, ItemRequestError | ItemUnavailableError>;
    readonly create: (
      projectId: ProjectId,
      url: string,
    ) => Effect.Effect<Item, ItemRequestError | ItemUnavailableError>;
  }
>()("@p4code/core/ItemService") {}

const decodeSummaries = Schema.decodeUnknownEffect(Schema.Array(ItemSummary));
const decodeItem = Schema.decodeUnknownEffect(Item);
const decodeComments = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Array(IssueComment)),
);
const encodeComments = Schema.encodeSync(Schema.fromJsonString(Schema.Array(IssueComment)));
const decodeUrl = Schema.decodeUnknownEffect(IssueUrl);
const isRequestError = Schema.is(ItemRequestError);
const isUnavailableError = Schema.is(ItemUnavailableError);

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const github = yield* GitHubIssue.GitHubIssue;
  const projects = yield* Projects;
  const threadLauncher = yield* ItemThreadLauncher;
  const threadReader = yield* ItemThreadReader;
  const version = yield* sql<{ user_version: number }>`PRAGMA user_version`;
  const schemaVersion = version[0]?.user_version ?? 0;
  if (schemaVersion > 4)
    return yield* new ItemUnavailableError({
      message: "This p4code database requires a newer app.",
    });
  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY, project_id TEXT NOT NULL, url TEXT NOT NULL,
      title TEXT NOT NULL, state TEXT NOT NULL, author TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '', comments TEXT NOT NULL DEFAULT '[]', last_refreshed_at TEXT
    )`;
      yield* sql`CREATE INDEX IF NOT EXISTS items_project ON items(project_id)`;
      if (schemaVersion === 1) {
        yield* sql`ALTER TABLE items ADD COLUMN body TEXT NOT NULL DEFAULT ''`;
        yield* sql`ALTER TABLE items ADD COLUMN comments TEXT NOT NULL DEFAULT '[]'`;
      }
      if (schemaVersion > 0 && schemaVersion < 3)
        yield* sql`ALTER TABLE items ADD COLUMN last_refreshed_at TEXT`;
      yield* sql`CREATE TABLE IF NOT EXISTS item_threads (
        id INTEGER PRIMARY KEY, item_id TEXT NOT NULL, thread_id TEXT NOT NULL,
        UNIQUE (item_id, thread_id)
      )`;
      yield* sql`CREATE INDEX IF NOT EXISTS item_threads_item ON item_threads(item_id, id)`;
      yield* sql`PRAGMA user_version = 4`;
    }),
  );
  const requireProject = Effect.fn(function* (projectId: ProjectId) {
    if (!(yield* projects.exists(projectId)))
      return yield* new ItemRequestError({ message: "Project not found." });
  });
  const listThreads = (projectId: ProjectId, itemId: string) =>
    Effect.gen(function* () {
      const rows = yield* sql<{
        threadId: string;
      }>`SELECT thread_id AS "threadId" FROM item_threads WHERE item_id = ${itemId} ORDER BY id`;
      return yield* Effect.forEach(rows, ({ threadId }) =>
        threadReader
          .isAvailable({ projectId, threadId })
          .pipe(Effect.map((available) => ({ threadId, available }))),
      );
    });
  const list = Effect.fn("ItemService.list")(
    function* (projectId: ProjectId) {
      yield* requireProject(projectId);
      const rows =
        yield* sql`SELECT CAST(id AS TEXT) AS id, project_id AS "projectId", url, title, state, author FROM items WHERE project_id = ${projectId} ORDER BY rowid`;
      return yield* decodeSummaries(rows);
    },
    Effect.mapError((cause) =>
      isRequestError(cause) || isUnavailableError(cause)
        ? cause
        : new ItemUnavailableError({ message: "Could not read Items." }),
    ),
  );
  const create = Effect.fn("ItemService.create")(
    function* (projectId: ProjectId, url: string) {
      yield* requireProject(projectId);
      const validUrl = yield* decodeUrl(url).pipe(
        Effect.mapError(
          () =>
            new ItemRequestError({
              message: "Paste a GitHub issue URL such as https://github.com/owner/repo/issues/123.",
            }),
        ),
      );
      const issue = yield* github.fetch(validUrl);
      const lastRefreshedAt = DateTime.formatIso(
        DateTime.makeUnsafe(yield* Clock.currentTimeMillis),
      );
      const rows = yield* sql<{
        id: string;
      }>`INSERT INTO items (project_id, url, title, state, author, body, comments, last_refreshed_at) VALUES (${projectId}, ${issue.url}, ${issue.title}, ${issue.state}, ${issue.author}, ${issue.body}, ${encodeComments(issue.comments)}, ${lastRefreshedAt}) RETURNING CAST(id AS TEXT) AS id`;
      return yield* decodeItem({
        id: rows[0]?.id,
        projectId,
        ...issue,
        threads: [],
        lastRefreshedAt,
        refreshError: null,
      });
    },
    Effect.mapError((cause) =>
      isRequestError(cause) || isUnavailableError(cause)
        ? cause
        : new ItemUnavailableError({ message: "Could not create the Item." }),
    ),
  );
  const refresh = Effect.fn("ItemService.refresh")(
    function* (projectId: ProjectId, itemId: string) {
      yield* requireProject(projectId);
      const rows =
        yield* sql`SELECT CAST(id AS TEXT) AS id, project_id AS "projectId", url, title, state, author, body, comments, last_refreshed_at AS "lastRefreshedAt" FROM items WHERE project_id = ${projectId} AND id = ${itemId}`;
      const row = rows[0];
      if (!row) return yield* new ItemRequestError({ message: "Item not found." });
      const comments = yield* decodeComments(String(row.comments));
      const cached = yield* decodeItem({
        ...row,
        comments,
        threads: yield* listThreads(projectId, itemId),
        refreshError: null,
      });
      return yield* github.fetch(cached.url).pipe(
        Effect.matchEffect({
          onFailure: (error) => decodeItem({ ...cached, refreshError: error.message }),
          onSuccess: (issue) =>
            Effect.gen(function* () {
              const lastRefreshedAt = DateTime.formatIso(
                DateTime.makeUnsafe(yield* Clock.currentTimeMillis),
              );
              yield* sql`UPDATE items SET url = ${issue.url}, title = ${issue.title}, state = ${issue.state}, author = ${issue.author}, body = ${issue.body}, comments = ${encodeComments(issue.comments)}, last_refreshed_at = ${lastRefreshedAt} WHERE project_id = ${projectId} AND id = ${itemId}`;
              return yield* decodeItem({
                ...cached,
                ...issue,
                threads: cached.threads,
                lastRefreshedAt,
                refreshError: null,
              });
            }),
        }),
      );
    },
    Effect.mapError((cause) =>
      isRequestError(cause) || isUnavailableError(cause)
        ? cause
        : new ItemUnavailableError({ message: "Could not read the Item." }),
    ),
  );
  const startThread = Effect.fn("ItemService.startThread")(
    function* (projectId: ProjectId, itemId: string) {
      yield* requireProject(projectId);
      const rows = yield* sql<{
        title: string;
      }>`SELECT title FROM items WHERE project_id = ${projectId} AND id = ${itemId}`;
      const item = rows[0];
      if (!item) return yield* new ItemRequestError({ message: "Item not found." });
      const threadId = yield* threadLauncher.launch({ projectId, title: item.title });
      yield* sql`INSERT INTO item_threads (item_id, thread_id) VALUES (${itemId}, ${threadId}) ON CONFLICT(item_id, thread_id) DO NOTHING`;
      return threadId;
    },
    Effect.mapError((cause) =>
      isRequestError(cause) || isUnavailableError(cause)
        ? cause
        : new ItemUnavailableError({ message: "Could not start a Thread for this Item." }),
    ),
  );
  return ItemService.of({ list, get: refresh, refresh, create, startThread });
});

/** A private SQL layer keeps p4code queries away from T3's database service. */
export const layer = (filename: string) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      yield* fs.makeDirectory(path.dirname(filename), { recursive: true });
      return Layer.effect(ItemService, make).pipe(
        Layer.provide(NodeSqliteClient.layer({ filename })),
      );
    }),
  );
