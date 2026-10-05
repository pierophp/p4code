import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { EnvironmentSupervisor, EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import { createEnvironmentCommand } from "@t3tools/client-runtime/state/runtime";
import { ManagedRelay } from "@t3tools/client-runtime/relay";
import * as RemoteAuthorization from "../../client-runtime/src/authorization/service.ts";
import type { Atom } from "effect/unstable/reactivity";
import type { HttpClient } from "effect/unstable/http";
import type { ProjectId } from "@t3tools/contracts";
import { executeItemsHttpRequest } from "./http.ts";

export function createItemsAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | HttpClient.HttpClient | R, E>,
) {
  const request = Effect.fn(function* (input: { projectId: ProjectId; url?: string }) {
    const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
    const prepared = yield* SubscriptionRef.get(supervisor.prepared);
    if (Option.isNone(prepared))
      return yield* Effect.fail(new Error("Reconnect to this environment to use Items."));
    const signer = yield* Effect.serviceOption(ManagedRelay.ManagedRelayDpopSigner);
    const remoteAuthorization = yield* Effect.serviceOption(
      RemoteAuthorization.RemoteEnvironmentAuthorization,
    );
    return yield* executeItemsHttpRequest({
      prepared: prepared.value,
      signer,
      remoteAuthorization,
      method: input.url === undefined ? "GET" : "POST",
      url: (baseUrl) =>
        new URL(
          `/api/p4code/projects/${encodeURIComponent(input.projectId)}/items`,
          baseUrl,
        ).toString(),
      timeoutMs: 35_000,
      request: ({ client, headers }) =>
        input.url === undefined
          ? client.list({ params: { projectId: input.projectId }, headers })
          : client
              .create({
                params: { projectId: input.projectId },
                payload: { url: input.url },
                headers,
              })
              .pipe(Effect.map((item) => [item])),
    });
  });
  return createEnvironmentCommand(runtime, { label: "p4code:items", execute: request });
}
