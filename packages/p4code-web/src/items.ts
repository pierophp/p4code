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
import type { Item } from "@p4code/contracts/items";
import { ItemUnavailableError } from "@p4code/contracts/items";
import { executeItemsHttpRequest } from "./http.ts";

export type { ItemSummary } from "@p4code/contracts/items";

export function createItemsAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | HttpClient.HttpClient | R, E>,
) {
  const request = Effect.fn(function* (input: { projectId: ProjectId; url?: string }) {
    const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
    const prepared = yield* SubscriptionRef.get(supervisor.prepared);
    if (Option.isNone(prepared))
      return yield* new ItemUnavailableError({
        message: "Reconnect to this environment to use Items.",
      });
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

export function createItemDetailAtom<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | HttpClient.HttpClient | R, E>,
) {
  const request = Effect.fn(function* (input: { projectId: ProjectId; itemId: string }) {
    const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
    const prepared = yield* SubscriptionRef.get(supervisor.prepared);
    if (Option.isNone(prepared))
      return yield* new ItemUnavailableError({
        message: "Reconnect to this environment to use Items.",
      });
    const signer = yield* Effect.serviceOption(ManagedRelay.ManagedRelayDpopSigner);
    const remoteAuthorization = yield* Effect.serviceOption(
      RemoteAuthorization.RemoteEnvironmentAuthorization,
    );
    const item: Item = yield* executeItemsHttpRequest({
      prepared: prepared.value,
      signer,
      remoteAuthorization,
      method: "GET",
      url: (baseUrl) =>
        new URL(
          `/api/p4code/projects/${encodeURIComponent(input.projectId)}/items/${encodeURIComponent(input.itemId)}`,
          baseUrl,
        ).toString(),
      timeoutMs: 35_000,
      request: ({ client, headers }) =>
        client.get({ params: { projectId: input.projectId, itemId: input.itemId }, headers }),
    });
    return item;
  });
  return createEnvironmentCommand(runtime, { label: "p4code:item-detail", execute: request });
}

export function createItemRefreshAtom<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | HttpClient.HttpClient | R, E>,
) {
  const request = Effect.fn(function* (input: { projectId: ProjectId; itemId: string }) {
    const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
    const prepared = yield* SubscriptionRef.get(supervisor.prepared);
    if (Option.isNone(prepared))
      return yield* new ItemUnavailableError({
        message: "Reconnect to this environment to use Items.",
      });
    const signer = yield* Effect.serviceOption(ManagedRelay.ManagedRelayDpopSigner);
    const remoteAuthorization = yield* Effect.serviceOption(
      RemoteAuthorization.RemoteEnvironmentAuthorization,
    );
    return yield* executeItemsHttpRequest({
      prepared: prepared.value,
      signer,
      remoteAuthorization,
      method: "POST",
      url: (baseUrl) =>
        new URL(
          `/api/p4code/projects/${encodeURIComponent(input.projectId)}/items/${encodeURIComponent(input.itemId)}/refresh`,
          baseUrl,
        ).toString(),
      timeoutMs: 35_000,
      request: ({ client, headers }) =>
        client.refresh({ params: { projectId: input.projectId, itemId: input.itemId }, headers }),
    });
  });
  return createEnvironmentCommand(runtime, { label: "p4code:item-refresh", execute: request });
}

export function createItemThreadAtom<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | HttpClient.HttpClient | R, E>,
) {
  const request = Effect.fn(function* (input: { projectId: ProjectId; itemId: string }) {
    const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
    const prepared = yield* SubscriptionRef.get(supervisor.prepared);
    if (Option.isNone(prepared))
      return yield* new ItemUnavailableError({
        message: "Reconnect to this environment to use Items.",
      });
    const signer = yield* Effect.serviceOption(ManagedRelay.ManagedRelayDpopSigner);
    const remoteAuthorization = yield* Effect.serviceOption(
      RemoteAuthorization.RemoteEnvironmentAuthorization,
    );
    return yield* executeItemsHttpRequest({
      prepared: prepared.value,
      signer,
      remoteAuthorization,
      method: "POST",
      url: (baseUrl) =>
        new URL(
          `/api/p4code/projects/${encodeURIComponent(input.projectId)}/items/${encodeURIComponent(input.itemId)}/threads`,
          baseUrl,
        ).toString(),
      timeoutMs: 35_000,
      request: ({ client, headers }) =>
        client
          .startThread({
            params: { projectId: input.projectId, itemId: input.itemId },
            headers,
          })
          .pipe(Effect.map(({ threadId }) => threadId)),
    });
  });
  return createEnvironmentCommand(runtime, { label: "p4code:item-start-thread", execute: request });
}
