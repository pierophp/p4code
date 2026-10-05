import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { LinkItemThreadPayload } from "./items.ts";

const decodeLinkPayload = Schema.decodeSync(LinkItemThreadPayload);

it("requires a non-blank Thread ID when linking an Item", () => {
  expect(decodeLinkPayload({ threadId: "thread-1" })).toEqual({
    threadId: "thread-1",
  });
  expect(() => decodeLinkPayload({ threadId: " \t " })).toThrow();
  expect(() => decodeLinkPayload({ threadId: 1 } as never)).toThrow();
});
