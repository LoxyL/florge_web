/**
 * Shared fetch helpers for Anvil pages (main studio + timeline).
 */

export async function fetchAnvilWorldsList() {
    const response = await fetch('/gpt/anvil/worlds');
    const data = await response.json().catch(() => []);
    return { response, data };
}

export async function fetchAnvilWorld(worldId) {
    const response = await fetch(`/gpt/anvil/world/${encodeURIComponent(worldId)}`);
    const data = await response.json().catch(() => ({}));
    return { response, data };
}
