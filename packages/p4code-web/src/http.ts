import { ItemsApi } from "@p4code/contracts/items";
import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { HttpClient, FetchHttpClient, type HttpMethod } from "effect/unstable/http";

import type { RemoteEnvironmentAuthorization } from "../../client-runtime/src/authorization/service.ts";
import type {
  PreparedConnection,
  PreparedHttpAuthorization,
} from "@t3tools/client-runtime/connection";
import type { ManagedRelay } from "@t3tools/client-runtime/relay";
import {
  executeEnvironmentHttpRequest,
  RemoteEnvironmentAuthFetchError,
  RemoteEnvironmentAuthTimeoutError,
  type RemoteEnvironmentRequestError,
} from "@t3tools/client-runtime/rpc";

const makeItemsClient = (baseUrl: string) =>
  Effect.flatMap(HttpClient.HttpClient, (httpClient) =>
    HttpApiClient.group(ItemsApi, { baseUrl, group: "items", httpClient }),
  );

interface EnvironmentHttpAuthHeaders {
  readonly authorization?: string;
  readonly dpop?: string;
}

/**
 * Primary/local environments with no bearer or DPoP credential authenticate the
 * browser via a session cookie. A cross-origin `fetch` does not send cookies by
 * default, so those requests must opt into credentialed mode; bearer/DPoP
 * connections carry their credential in a header and need no cookies. Applied
 * per-request via `FetchHttpClient.RequestInit`, which the fetch client reads
 * from the fiber context at request time.
 */
const withEnvironmentCredentials = <A, E, R>(
  authorization: PreparedHttpAuthorization | null,
  request: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  authorization === null
    ? request.pipe(Effect.provideService(FetchHttpClient.RequestInit, { credentials: "include" }))
    : request;

/**
 * Build request-bound headers from the current environment credential:
 * - primary/local connections carry no credential,
 * - bearer connections send a static `Bearer` token,
 * - relay connections send a `DPoP` access token with a freshly signed proof
 *   bound to this request's method and URL.
 *
 * The DPoP signer is passed in (not resolved from context) and is only required
 * for relay/DPoP connections, so bearer/primary connections work even when no
 * signer is available.
 */
const buildEnvironmentAuthHeaders = (
  authorization: PreparedHttpAuthorization | null,
  method: HttpMethod.HttpMethod,
  url: string,
  signer: Option.Option<ManagedRelay.ManagedRelayDpopSigner["Service"]>,
): Effect.Effect<EnvironmentHttpAuthHeaders, RemoteEnvironmentAuthFetchError> =>
  Effect.gen(function* () {
    if (authorization === null) {
      return {};
    }
    if (authorization._tag === "Bearer") {
      return { authorization: `Bearer ${authorization.token}` };
    }
    if (Option.isNone(signer)) {
      return yield* new RemoteEnvironmentAuthFetchError({
        message: "No DPoP signer is available to authorize the environment request.",
        cause: authorization._tag,
      });
    }
    const proof = yield* signer.value
      .createProof({ method, url, accessToken: authorization.accessToken })
      .pipe(
        Effect.mapError(
          (cause) =>
            new RemoteEnvironmentAuthFetchError({
              message: "Could not create the environment request authorization proof.",
              cause,
            }),
        ),
      );
    return { authorization: `DPoP ${authorization.accessToken}`, dpop: proof };
  });

/**
 * Resolve relay credentials at request time without replacing the live socket.
 * A rejected credential gets one refresh and retry, with a new request-bound
 * proof. Cookie and bearer requests keep their existing authentication behavior.
 */
export const executeItemsHttpRequest = Effect.fn("p4code.executeItemsHttpRequest")(function* <
  A,
  E,
  R,
>(input: {
  readonly prepared: PreparedConnection;
  readonly signer: Option.Option<ManagedRelay.ManagedRelayDpopSigner["Service"]>;
  readonly remoteAuthorization?: Option.Option<RemoteEnvironmentAuthorization["Service"]>;
  readonly method: HttpMethod.HttpMethod;
  readonly url: (httpBaseUrl: string) => string;
  readonly timeoutMs: number;
  readonly request: (input: {
    readonly client: Effect.Success<ReturnType<typeof makeItemsClient>>;
    readonly headers: EnvironmentHttpAuthHeaders;
  }) => Effect.Effect<A, E, R>;
}): Effect.fn.Return<
  A,
  RemoteEnvironmentRequestError,
  Effect.Services<ReturnType<typeof makeItemsClient>> | R
> {
  let httpBaseUrl = input.prepared.httpBaseUrl;
  return yield* Effect.gen(function* () {
    let rejectedAccessToken: string | undefined;
    for (;;) {
      let authorization = input.prepared.httpAuthorization;
      if (authorization?._tag === "Dpop") {
        const remote = input.remoteAuthorization;
        if (remote === undefined || Option.isNone(remote)) {
          return yield* new RemoteEnvironmentAuthFetchError({
            message: "No relay authorization service is available for the environment request.",
            cause: input.prepared.target._tag,
          });
        }
        const current = yield* remote.value
          .authorizeDpopHttp({
            expectedEnvironmentId: input.prepared.environmentId,
            ...(rejectedAccessToken === undefined ? {} : { rejectedAccessToken }),
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new RemoteEnvironmentAuthFetchError({
                  message: "Could not authorize the environment request.",
                  cause,
                }),
            ),
          );
        httpBaseUrl = current.httpBaseUrl;
        authorization = current.httpAuthorization;
      }

      const requestUrl = input.url(httpBaseUrl);
      const client = yield* makeItemsClient(httpBaseUrl);
      const headers = yield* buildEnvironmentAuthHeaders(
        authorization,
        input.method,
        requestUrl,
        input.signer,
      );
      const result = yield* executeEnvironmentHttpRequest(
        requestUrl,
        input.timeoutMs,
        withEnvironmentCredentials(authorization, input.request({ client, headers })),
      ).pipe(Effect.result);

      if (Result.isFailure(result)) {
        if (
          authorization?._tag === "Dpop" &&
          rejectedAccessToken === undefined &&
          result.failure._tag === "EnvironmentAuthInvalidError" &&
          result.failure.reason === "invalid_credential"
        ) {
          rejectedAccessToken = authorization.accessToken;
          continue;
        }
        return yield* result.failure;
      }

      return result.success;
    }
  }).pipe(
    Effect.timeoutOrElse({
      duration: input.timeoutMs,
      orElse: () =>
        Effect.fail(new RemoteEnvironmentAuthTimeoutError(input.url(httpBaseUrl), input.timeoutMs)),
    }),
  );
});
