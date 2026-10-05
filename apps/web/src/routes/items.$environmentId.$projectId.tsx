import { createFileRoute, redirect } from "@tanstack/react-router";
import { useCallback } from "react";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { ItemsView } from "@p4code/web/ItemsView";
import { createItemsAtoms } from "@p4code/web/items";
import { connectionAtomRuntime } from "../connection/runtime";
import { useAtomCommand } from "../state/use-atom-command";

const items = createItemsAtoms(connectionAtomRuntime);
export const Route = createFileRoute("/items/$environmentId/$projectId")({
  beforeLoad: ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: ItemsPage,
});
function ItemsPage() {
  const { environmentId, projectId } = Route.useParams();
  const run = useAtomCommand(items, { reportFailure: false });
  const list = useCallback(async () => {
    const result = await run({
      environmentId: EnvironmentId.make(environmentId),
      input: { projectId: ProjectId.make(projectId) },
    });
    if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    return result.value;
  }, [run, environmentId, projectId]);
  const create = useCallback(
    async (url: string) => {
      const result = await run({
        environmentId: EnvironmentId.make(environmentId),
        input: { projectId: ProjectId.make(projectId), url },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    },
    [run, environmentId, projectId],
  );
  return <ItemsView key={`${environmentId}:${projectId}`} list={list} create={create} />;
}
