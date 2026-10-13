/**
 * Thin wrapper around api-client + tokenStore. Commands call these
 * functions rather than touching the token store or the API directly.
 */
import { api } from "../api-client/client";
import { clearToken, getToken, setToken } from "./tokenStore";

export async function isLoggedIn(): Promise<boolean> {
  return (await getToken()) !== undefined;
}

export async function loginWithCredentials(username: string, password: string): Promise<void> {
  const issued = await api.login(username, password, "VS Code");
  await setToken(issued.token);
}

export async function logout(): Promise<void> {
  await clearToken();
}
