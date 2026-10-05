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
  const version = yield* sql<{ user_version: number }>`PRAGMA user_version`;
  const schemaVersion = version[0]?.user_version ?? 0;
  if (schemaVersion > 3)
    return yield* new ItemUnavailableError({
      message: "This p4code database requires a newer app.",
    });
  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY, project_id TEXT NOT NULL, url TEXT NOT NULL,
      title TEXT NOT NULL, state TEXT NOT NULL, author TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '', comments TEXT NOT NULL DEFAULT '[]'
    )`;
      yield* sql`CREATE INDEX IF NOT EXISTS items_project ON items(project_id)`;
      if (schemaVersion === 1) {
        yield* sql`ALTER TABLE items ADD COLUMN body TEXT NOT NULL DEFAULT ''`;
        yield* sql`ALTER TABLE items ADD COLUMN comments TEXT NOT NULL DEFAULT '[]'`;
      }
      if (schemaVersion < 3) yield* sql`ALTER TABLE items ADD COLUMN last_refreshed_at TEXT`;
      yield* sql`PRAGMA user_version = 3`;
    }),
  );
  const requireProject = Effect.fn(function* (projectId: ProjectId) {
    if (!(yield* projects.exists(projectId)))
      return yield* new ItemRequestError({ message: "Project not found." });
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
      const cached = yield* decodeItem({ ...row, comments, refreshError: null });
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
  return ItemService.of({ list, get: refresh, refresh, create });
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
