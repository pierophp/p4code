import { useEffect, useState } from "react";
import * as DateTime from "effect/DateTime";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Item, ItemSummary } from "@p4code/contracts/items";

export function ItemsView({
  list,
  create,
  get,
  refresh,
  startThread,
  openThread,
}: {
  list: () => Promise<ReadonlyArray<ItemSummary>>;
  create: (url: string) => Promise<void>;
  get: (item: ItemSummary) => Promise<Item>;
  refresh: (item: ItemSummary) => Promise<Item>;
  startThread: (item: ItemSummary) => Promise<string>;
  openThread: (threadId: string) => void;
}) {
  const [items, setItems] = useState<ReadonlyArray<ItemSummary>>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ itemId: string; value: Item } | null>(null);
  const [detailError, setDetailError] = useState<{ itemId: string; message: string } | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [startingThread, setStartingThread] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void list()
      .then(
        (items) => {
          if (active) setItems(items);
        },
        (error: unknown) => {
          if (active) setError(error instanceof Error ? error.message : String(error));
        },
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [list]);
  useEffect(() => {
    const item = items.find((candidate) => candidate.id === selected);
    if (!item) return;
    let active = true;
    void get(item).then(
      (value) => {
        if (active) {
          setDetail({ itemId: item.id, value });
          setDetailError(null);
        }
      },
      (error: unknown) => {
        if (active)
          setDetailError({
            itemId: item.id,
            message: error instanceof Error ? error.message : String(error),
          });
      },
    );
    return () => {
      active = false;
    };
  }, [get, items, selected]);
  const selectedDetail = detail?.itemId === selected ? detail.value : null;
  const selectedDetailError = detailError?.itemId === selected ? detailError.message : null;
  const detailLoading =
    selected !== null && selectedDetail === null && selectedDetailError === null;
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold">Items</h1>
      <form
        className="flex gap-2"
        onSubmit={async (event) => {
          event.preventDefault();
          setCreating(true);
          setError(null);
          try {
            await create(url.trim());
            setItems(await list());
            setUrl("");
          } catch (error) {
            setError(error instanceof Error ? error.message : String(error));
          } finally {
            setCreating(false);
          }
        }}
      >
        <label className="flex flex-1 flex-col gap-1">
          GitHub issue URL
          <input
            className="rounded border bg-background p-2"
            type="url"
            value={url}
            required
            placeholder="https://github.com/owner/repo/issues/123"
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <button
          className="self-end rounded border px-4 py-2 disabled:opacity-50"
          disabled={loading || creating}
          type="submit"
        >
          {creating ? "Adding…" : "Add Item"}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {loading ? (
        <p role="status">Loading Items…</p>
      ) : items.length === 0 ? (
        <p>No Items in this Project yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.id} className="rounded border p-4">
              <button
                className="font-medium underline"
                type="button"
                aria-expanded={selected === item.id}
                onClick={() => setSelected(selected === item.id ? null : item.id)}
              >
                {item.title}
              </button>
              <p>
                {item.state.toLowerCase()} · {item.author}
              </p>
              <p className="break-all text-sm text-muted-foreground">{item.url}</p>
              {selected === item.id && (
                <section className="mt-4 flex min-w-0 flex-col gap-5 border-t pt-4">
                  {detailLoading ? (
                    <p role="status">Loading issue details…</p>
                  ) : selectedDetail ? (
                    <>
                      {selectedDetailError && <p role="alert">{selectedDetailError}</p>}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm text-muted-foreground">
                          {selectedDetail.lastRefreshedAt
                            ? `Last refreshed ${DateTime.formatIntl(DateTime.makeUnsafe(selectedDetail.lastRefreshedAt), new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }))} (${formatAge(selectedDetail.lastRefreshedAt)} ago)`
                            : "Not refreshed yet"}
                        </p>
                        <button
                          className="rounded border px-3 py-1 text-sm disabled:opacity-50"
                          type="button"
                          disabled={refreshing === selectedDetail.id}
                          onClick={async () => {
                            setRefreshing(selectedDetail.id);
                            try {
                              const value = await refresh(item);
                              setDetail({ itemId: selectedDetail.id, value });
                              setDetailError(null);
                            } catch (error) {
                              setDetailError({
                                itemId: item.id,
                                message: error instanceof Error ? error.message : String(error),
                              });
                            } finally {
                              setRefreshing(null);
                            }
                          }}
                        >
                          {refreshing === selectedDetail.id ? "Refreshing…" : "Refresh"}
                        </button>
                      </div>
                      <section className="flex flex-col gap-2" aria-label="Threads">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h2 className="font-semibold">
                            Threads ({selectedDetail.threads.length})
                          </h2>
                          <button
                            className="rounded border px-3 py-1 text-sm disabled:opacity-50"
                            type="button"
                            disabled={startingThread === selectedDetail.id}
                            onClick={async () => {
                              setStartingThread(selectedDetail.id);
                              setError(null);
                              try {
                                const threadId = await startThread(item);
                                openThread(threadId);
                              } catch (error) {
                                setError(error instanceof Error ? error.message : String(error));
                              } finally {
                                setStartingThread(null);
                              }
                            }}
                          >
                            {startingThread === selectedDetail.id ? "Starting…" : "Start Thread"}
                          </button>
                        </div>
                        {selectedDetail.threads.length === 0 ? (
                          <p className="text-sm text-muted-foreground">No Threads yet.</p>
                        ) : (
                          <ul className="flex flex-col gap-1">
                            {selectedDetail.threads.map(({ threadId }) => (
                              <li key={threadId}>
                                <button
                                  className="break-all text-left text-sm underline"
                                  type="button"
                                  onClick={() => openThread(threadId)}
                                >
                                  Open Thread {threadId}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </section>
                      {selectedDetail.refreshError && (
                        <p role="alert">Refresh failed: {selectedDetail.refreshError}</p>
                      )}
                      <article className="min-w-0 break-words">
                        <h2 className="mb-2 font-semibold">Issue description</h2>
                        {selectedDetail.body ? (
                          <div className="max-w-none overflow-x-auto [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-3 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {selectedDetail.body}
                            </ReactMarkdown>
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">No issue description.</p>
                        )}
                      </article>
                      <section className="flex min-w-0 flex-col gap-3" aria-label="Issue comments">
                        <h2 className="font-semibold">
                          Comments ({selectedDetail.comments.length})
                        </h2>
                        {selectedDetail.comments.length === 0 ? (
                          <p className="text-sm text-muted-foreground">No comments.</p>
                        ) : (
                          selectedDetail.comments.map((comment) => (
                            <article
                              key={`${comment.createdAt}:${comment.author}:${comment.body}`}
                              className="min-w-0 rounded border p-3"
                            >
                              <header className="mb-2 flex flex-wrap gap-x-2 text-sm">
                                <strong>{comment.author}</strong>
                                <time
                                  dateTime={comment.createdAt}
                                  className="text-muted-foreground"
                                >
                                  {comment.createdAt}
                                </time>
                              </header>
                              <div className="min-w-0 break-words overflow-x-auto [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-3 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                  {comment.body}
                                </ReactMarkdown>
                              </div>
                            </article>
                          ))
                        )}
                      </section>
                    </>
                  ) : selectedDetailError ? (
                    <p role="alert">{selectedDetailError}</p>
                  ) : null}
                </section>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function formatAge(timestamp: string) {
  const minutes = Math.max(
    0,
    Math.floor(
      (DateTime.toEpochMillis(DateTime.nowUnsafe()) -
        DateTime.toEpochMillis(DateTime.makeUnsafe(timestamp))) /
        60_000,
    ),
  );
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"}`;
}
