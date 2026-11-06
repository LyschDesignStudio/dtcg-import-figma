# DTCG Import for Figma

A Figma plugin that imports design tokens in the [DTCG format](https://www.designtokens.org/) from a GitHub repository into Figma variables, text styles and effect styles.

It only reads. It never writes to the repository: every request it makes is a `GET` to `api.github.com`.

## Load it in Figma

The built plugin is included in this repository (`dist/`), so there is nothing to install or build.

1. Download this repository: on GitHub, *Code → Download ZIP*, then unzip it.
2. Open the Figma desktop app (plugins in development can't be loaded in the browser) and open a design file.
3. *Plugins → Development → Import plugin from manifest…*, and choose `manifest.json` in the unzipped folder.
4. Run it from *Plugins → Development → DTCG Import for Figma*.

Keep the folder where it is: Figma loads the plugin from it each time it runs.

## What it does

1. **Connect** a GitHub repository: `owner/name` or its `github.com` address. Optionally, a folder and a branch (the default branch otherwise). The plugin finds the folder that holds the tokens and which layout it uses. When there are several, it asks which one.
2. **Review** what will be imported: how many variables and styles, in which collections and modes. Anything it had to assume (the layout, the role of each file, the rem base) is under *Details* and can be changed.
3. **Import** into the Figma file: collections, modes, variables (with aliases across collections), scopes, text styles and effect styles. If the file already has variables or styles with the same names, the plugin asks whether to adopt them or create new ones.
4. **Import again** later. The panel shows whether the file is up to date, what changed in the repository, and which values were edited in Figma since the last import. Importing again brings the repository's values in. Before anything is renamed or removed, it shows a preview. Variables the repository removed are never deleted automatically: they are listed, and you choose what to delete.

The connection is kept in the Figma file, so each file can follow its own folder, even within the same repository.

## Supported layouts

| Layout | How the plugin recognizes it | Where the modes come from |
| --- | --- | --- |
| **DTCG with a resolver** | a `*.resolver.json` file | The resolver's sets and modifiers (light/dark, brands, sizes…) |
| **Tokens Studio** | a `$themes.json` file (or a single file holding `$themes`) | Each theme group becomes a collection's modes |
| **DTCG token files** | `*.tokens.json` files | Read from the file names (`color.dark.tokens.json` is the dark mode of `color`); you can edit the roles, and modes kept in `$extensions` are supported |

Values: DTCG 2025.10 colors (`srgb`, `hsl`, `oklch`… converted to sRGB, out-of-gamut values clipped and listed), dimensions in `px` or `rem`, numbers, strings, booleans, font families and weights, durations, shadows (as effect styles) and typography (as text styles). Tokens Figma has no variable type for (`cubicBezier`, `transition`, Tokens Studio math and color modifiers) stay out and are listed under *Notes*.

## GitHub token

- **Public repository:** leave the token empty.
- **Private repository:** create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) with:
  - *Repository access:* only the repository with your tokens;
  - *Permissions → Repository permissions → Contents:* **Read-only** (GitHub adds *Metadata: Read-only* on its own).

  No other permission is needed. If the repository belongs to an organization, the organization may have to approve the token, or you may have to authorize it for single sign-on. The plugin says which.

The token is kept in Figma's client storage, on your computer only, one per repository. It is never stored in the Figma file and never sent anywhere other than `api.github.com`.

Without a token, GitHub allows 60 requests an hour per IP address, and each token file is one request. For a large repository, any token (even one with no access to private repositories) raises the limit to 5,000.

## Build from source (optional)

Only needed to change the plugin. Requirements: Node.js 20.11 or later.

```bash
npm install
npm run build       # writes dist/code.js and dist/ui.html
```

`dist/` is committed so the plugin can be loaded straight from a download. After any change to the source, run `npm run build` and commit the updated `dist/` with it.

The `id` in `manifest.json` is a placeholder. To publish the plugin to the Figma Community, create a new plugin in Figma and replace the `id` with the one it gives you.

### Development

```bash
npm run typecheck   # TypeScript
npm test            # unit and UI tests (Vitest), on a fake Figma and a fake GitHub
npm run dev         # rebuilds the plugin's main code on change
npm run preview     # the panel in a browser, at http://localhost:5174/?scene=connect
```

The preview runs the real panel over a fake Figma document and a fake GitHub. Scenes are listed at the top of `preview/host.ts` (for example `?scene=found`, `?scene=diverged`, `?scene=removed`; add `&theme=dark` for the dark theme).

The test fixtures in `test/repos/` are one made-up design system written in each of the four layouts, so the tests can prove they produce the same result. `node scripts/fixtures.mjs` writes them again.

#### Layout of the source

- `src/main.ts`: the Figma sandbox. It has no network access; it applies the plan the UI sends.
- `src/handlers.ts`, `src/shared/protocol.ts`: the methods the UI calls in the sandbox.
- `src/github.ts`: the read-only GitHub client.
- `src/detect.ts`, `src/readers/`: which layout a folder holds, and each layout read into one model (`src/model.ts`).
- `src/plan.ts`, `src/tokens.ts`, `src/color.ts`, `src/scopes.ts`: the model turned into what the Figma file should hold.
- `src/apply.ts`, `src/status.ts`: the plan applied to the file, and where the file stands against the repository.
- `src/sync.ts`: the import flow, run from the UI.
- `src/ui/`: the panel (React).

## License

MIT. See [LICENSE](LICENSE).
