import { authClient } from './authClient'

export async function getSession() {
  const { data } = await authClient.getSession()
  return data
}
