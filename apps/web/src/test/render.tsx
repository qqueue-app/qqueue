import type { ReactElement, ReactNode } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "../lib/query-client.js";
import { TooltipProvider } from "../components/ui/tooltip.js";

/**
 * The app's real QueryClient, with the settings that would make tests slow or
 * order-dependent overridden: no retries (a failing request should surface
 * immediately rather than after three backoffs) and nothing cached between
 * tests. Everything else — including the global "couldn't load" toast — is the
 * production configuration, so tests exercise what actually ships.
 */
function createTestQueryClient() {
  const client = createQueryClient();
  client.setDefaultOptions({
    queries: { retry: false, gcTime: 0, staleTime: 0, refetchOnWindowFocus: false },
    mutations: { retry: false },
  });
  return client;
}

/**
 * Render a component inside the providers the app always supplies.
 *
 * Every page uses `useQuery` for its data and tooltipped icon buttons for its
 * actions, so both providers are part of the runtime contract — rendering
 * without them tests a configuration that never ships.
 */
export interface RenderWithProvidersOptions
  extends Omit<RenderOptions, "wrapper"> {
  /** Initial history entries, for pages that read route or query state. */
  route?: string;
  /** Skip the router when the component under test supplies its own. */
  withRouter?: boolean;
}

export function renderWithProviders(
  ui: ReactElement,
  { route = "/", withRouter = true, ...options }: RenderWithProvidersOptions = {}
) {
  const queryClient = createTestQueryClient();

  function Wrapper({ children }: { children: ReactNode }) {
    const inner = (
      <QueryClientProvider client={queryClient}>
        {/* delayDuration 0 so a hover in a test doesn't need a timer advance. */}
        <TooltipProvider delayDuration={0}>{children}</TooltipProvider>
      </QueryClientProvider>
    );
    return withRouter ? (
      <MemoryRouter initialEntries={[route]}>{inner}</MemoryRouter>
    ) : (
      inner
    );
  }

  return { queryClient, ...render(ui, { wrapper: Wrapper, ...options }) };
}

/**
 * Open a data-grid row's overflow menu.
 *
 * Rows show one or two primary actions inline and fold the rest behind a
 * "More actions for <row>" button, so a test that wants a secondary action has
 * to open the menu first — same as a person would.
 */
export async function openRowMenu(
  user: { click: (element: Element) => Promise<void> },
  rowLabel: string
) {
  const trigger = await screen.findByRole("button", {
    name: `More actions for ${rowLabel}`,
  });
  await user.click(trigger);
}

export * from "@testing-library/react";
import { screen } from "@testing-library/react";
