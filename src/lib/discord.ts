import { getSetting } from "./settings";

const API = "https://discord.com/api/v10";

export interface RoleResult {
  ok: boolean;
  /** Actionable note for the sale log, e.g. "bot lacks permission". */
  note: string;
}

export interface GuildMember {
  roles: string[];
  nick: string | null;
  avatar: string | null;
}

export interface GuildRole {
  id: string;
  name: string;
  position: number;
  managed: boolean;
}

function botToken(): string {
  return getSetting("discord_bot_token");
}

function guildId(): string {
  return getSetting("discord_guild_id");
}

/** Maps Discord API error responses onto the two common real-world failures. */
function classifyError(status: number, body: { code?: number; message?: string }): string {
  if (status === 403 || body.code === 50013) return "bot lacks permission (role hierarchy or missing Manage Roles)";
  if (body.code === 10007) return "user not in guild";
  if (body.code === 10011) return "role does not exist";
  if (status === 401) return "bot token invalid";
  return `discord error ${status}: ${body.message ?? "unknown"}`;
}

async function roleRequest(method: "PUT" | "DELETE", discordId: string, roleId: string): Promise<RoleResult> {
  const token = botToken();
  const guild = guildId();
  if (!token || !guild) return { ok: false, note: "discord bot not configured" };
  try {
    const res = await fetch(`${API}/guilds/${guild}/members/${discordId}/roles/${roleId}`, {
      method,
      headers: { Authorization: `Bot ${token}`, "X-Audit-Log-Reason": "Kez store purchase" },
    });
    if (res.status === 204) return { ok: true, note: "ok" };
    const body = await res.json().catch(() => ({}));
    const note = classifyError(res.status, body);
    console.error(`[discord] ${method} role ${roleId} for ${discordId} failed: ${note}`);
    return { ok: false, note };
  } catch (err) {
    console.error("[discord] network error", err);
    return { ok: false, note: "discord unreachable" };
  }
}

export function assignRole(discordId: string, roleId: string): Promise<RoleResult> {
  return roleRequest("PUT", discordId, roleId);
}

export function removeRole(discordId: string, roleId: string): Promise<RoleResult> {
  return roleRequest("DELETE", discordId, roleId);
}

export async function getGuildMember(discordId: string): Promise<GuildMember | null> {
  const token = botToken();
  const guild = guildId();
  if (!token || !guild) return null;
  try {
    const res = await fetch(`${API}/guilds/${guild}/members/${discordId}`, {
      headers: { Authorization: `Bot ${token}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { roles?: string[]; nick?: string; avatar?: string };
    return { roles: data.roles ?? [], nick: data.nick ?? null, avatar: data.avatar ?? null };
  } catch {
    return null;
  }
}

/** Live guild role list for the admin role picker. */
export async function getGuildRoles(): Promise<GuildRole[]> {
  const token = botToken();
  const guild = guildId();
  if (!token || !guild) return [];
  try {
    const res = await fetch(`${API}/guilds/${guild}/roles`, {
      headers: { Authorization: `Bot ${token}` },
    });
    if (!res.ok) return [];
    const roles = (await res.json()) as GuildRole[];
    return roles.sort((a, b) => b.position - a.position);
  } catch {
    return [];
  }
}

/* ─── OAuth2 (authorization code flow) ─── */

export interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  email: string | null;
  avatar: string | null;
}

export function buildAuthorizeUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID ?? "",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "identify email",
    state,
  });
  return `${API}/oauth2/authorize?${params}`;
}

export async function exchangeCode(code: string, redirectUri: string): Promise<string | null> {
  const res = await fetch(`${API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID ?? "",
      client_secret: process.env.DISCORD_CLIENT_SECRET ?? "",
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) {
    console.error("[discord] token exchange failed", res.status, await res.text());
    return null;
  }
  const data = (await res.json()) as { access_token?: string };
  return data.access_token ?? null;
}

export async function fetchDiscordUser(accessToken: string): Promise<DiscordUser | null> {
  const res = await fetch(`${API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as DiscordUser;
}
