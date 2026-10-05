import * as Schema from "effect/Schema";
import {
  ProjectId,
  EnvironmentAuthenticatedAuth,
  EnvironmentScopeRequiredError,
} from "@t3tools/contracts";
import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";

export const IssueUrl = Schema.String.check(
  Schema.isPattern(
    /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/[1-9][0-9]*$/,
  ),
);
export const IssueSnapshot = Schema.Struct({
  url: IssueUrl,
  title: Schema.String,
  state: Schema.Literals(["OPEN", "CLOSED"]),
  author: Schema.String,
});
export type IssueSnapshot = typeof IssueSnapshot.Type;
export const Item = Schema.Struct({
  id: Schema.String,
  projectId: ProjectId,
  ...IssueSnapshot.fields,
});
export type Item = typeof Item.Type;
export class ItemRequestError extends Schema.TaggedError<ItemRequestError>()(
  "ItemRequestError",
  {
    message: Schema.String,
  },
  { httpApiStatus: 400 },
) {}
export class ItemUnavailableError extends Schema.TaggedError<ItemUnavailableError>()(
  "ItemUnavailableError",
  {
    message: Schema.String,
  },
  { httpApiStatus: 502 },
) {}
const headers = Schema.Struct({
  authorization: Schema.optionalKey(Schema.String),
  dpop: Schema.optionalKey(Schema.String),
});
const params = Schema.Struct({ projectId: ProjectId });
const errors = [ItemRequestError, ItemUnavailableError, EnvironmentScopeRequiredError];
class Items extends HttpApiGroup.make("items")
  .add(
    HttpApiEndpoint.get("list", "/api/p4code/projects/:projectId/items", {
      params,
      headers,
      success: Schema.Array(Item),
      error: errors,
    }).middleware(EnvironmentAuthenticatedAuth),
  )
  .add(
    HttpApiEndpoint.post("create", "/api/p4code/projects/:projectId/items", {
      params,
      headers,
      payload: Schema.Struct({ url: IssueUrl }),
      success: Item,
      error: errors,
    }).middleware(EnvironmentAuthenticatedAuth),
  ) {}
export class ItemsApi extends HttpApi.make("p4code").add(Items) {}
