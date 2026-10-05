import { useEffect, useState } from "react";
import type { Item } from "@p4code/contracts/items";

export function ItemsView({
  list,
  create,
}: {
  list: () => Promise<ReadonlyArray<Item>>;
  create: (url: string) => Promise<void>;
}) {
  const [items, setItems] = useState<ReadonlyArray<Item>>([]);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
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
              <a className="font-medium underline" href={item.url} target="_blank" rel="noreferrer">
                {item.title}
              </a>
              <p>
                {item.state.toLowerCase()} · {item.author}
              </p>
              <p className="break-all text-sm text-muted-foreground">{item.url}</p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
