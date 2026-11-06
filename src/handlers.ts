/* What main does for the UI, by method name, over a Figma API: the real
   `figma` in src/main.ts, a fake one in the tests. */

import { getJson, setData } from "./figma/identity";
import type { MainToUi } from "./shared/protocol";
import { adoptionOf, applyDtcg, deleteRemoved, DKEYS, previewOf, readDtcg } from "./apply";
import type { DtcgLink } from "./model";

export function makeHandlers(figma: PluginAPI, post: (msg: MainToUi) => void) {
  return {
    dtcgLink: () => getJson<DtcgLink>(figma.root, DKEYS.link),
    dtcgRead: () => readDtcg(figma),
    dtcgPreview: ({ plan }: { plan: Parameters<typeof previewOf>[1] }) => previewOf(figma, plan),
    dtcgAdoption: ({ plan }: { plan: Parameters<typeof adoptionOf>[1] }) => adoptionOf(figma, plan),
    dtcgApply: async ({ plan, ...opts }: { plan: Parameters<typeof applyDtcg>[1] } & Parameters<typeof applyDtcg>[2]) => {
      const r = await applyDtcg(figma, plan, opts, (progress) => post({ type: "progress", progress }));
      figma.notify?.(r.incomplete ? `${plan.name}: import incomplete` : `${plan.name}: ${r.state.counts.variables} variables · ${r.state.counts.textStyles} text styles · ${r.state.counts.effectStyles} effect styles`, { error: r.incomplete });
      return r;
    },
    dtcgDelete: ({ ids }: { ids: string[] }) => deleteRemoved(figma, ids),
    dtcgSetLink: ({ link }: { link: DtcgLink | null }) => setData(figma.root, DKEYS.link, link ? JSON.stringify(link) : ""),
    storageGet: ({ key }: { key: string }): Promise<unknown> => figma.clientStorage.getAsync(key),
    storageSet: ({ key, value }: { key: string; value: unknown }): Promise<void> => (value === null || value === undefined ? figma.clientStorage.deleteAsync(key) : figma.clientStorage.setAsync(key, value)),
  };
}

export type Handlers = ReturnType<typeof makeHandlers>;
