import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { Item, IssueUrl, ItemRequestError, ItemUnavailableError } from "@p4code/contracts/items";
import type { ProjectId } from "@t3tools/contracts";
import * as GitHubIssue from "./GitHubIssue.ts";

export class Projects extends Context.Service<
  Projects,
  {
    readonly exists: (projectId: ProjectId) => Effect.Effect<boolean, ItemUnavailableError>;
  }
>()("p4code/Projects") {}
export class ItemService extends Context.Service<
  ItemService,
  {
    readonly list: (
      projectId: ProjectId,
    ) => Effect.Effect<ReadonlyArray<Item>, ItemRequestError | ItemUnavailableError>;
    readonly create: (
      projectId: ProjectId,
      url: string,
    ) => Effect.Effect<Item, ItemRequestError | ItemUnavailableError>;
  }
>()("p4code/ItemService") {}

const decodeItems = Schema.decodeUnknownEffect(Schema.Array(Item));
const decodeItem = Schema.decodeUnknownEffect(Item);
const decodeUrl = Schema.decodeUnknownEffect(IssueUrl);
const isRequestError = Schema.is(ItemRequestError);
const isUnavailableError = Schema.is(ItemUnavailableError);

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const github = yield* GitHubIssue.GitHubIssue;
  const projects = yield* Projects;
  const version = yield* sql<{ user_version: number }>`PRAGMA user_version`;
  if ((version[0]?.user_version ?? 0) > 1)
    return yield* new ItemUnavailableError({
      message: "This p4code database requires a newer app.",
    });
  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY, project_id TEXT NOT NULL, url TEXT NOT NULL,
      title TEXT NOT NULL, state TEXT NOT NULL, author TEXT NOT NULL
    )`;
      yield* sql`CREATE INDEX IF NOT EXISTS items_project ON items(project_id)`;
      yield* sql`PRAGMA user_version = 1`;
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
      return yield* decodeItems(rows);
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
      const rows = yield* sql<{
        id: string;
      }>`INSERT INTO items (project_id, url, title, state, author) VALUES (${projectId}, ${issue.url}, ${issue.title}, ${issue.state}, ${issue.author}) RETURNING CAST(id AS TEXT) AS id`;
      return yield* decodeItem({ id: rows[0]?.id, projectId, ...issue });
    },
    Effect.mapError((cause) =>
      isRequestError(cause) || isUnavailableError(cause)
        ? cause
        : new ItemUnavailableError({ message: "Could not create the Item." }),
    ),
  );
  return ItemService.of({ list, create });
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
