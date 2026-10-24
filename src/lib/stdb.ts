// One SpacetimeDB connection per process. Used by Mela on Azure (role "app") and by the Mac relay (role "relay").
// The token is the identity: keep the same token or the role claim no longer matches.
import { DbConnection } from "./module_bindings";

// Resolves once connected and the role is ours; rejects if the connection fails or another identity holds the role.
export function connectStdb(role: "app" | "relay", token: string | undefined): Promise<DbConnection> {
  const uri = process.env.SPACETIMEDB_URI;
  const db = process.env.SPACETIMEDB_MODULE;
  if (!uri || !db) return Promise.reject(new Error("set SPACETIMEDB_URI and SPACETIMEDB_MODULE"));

  return new Promise((resolve, reject) => DbConnection.builder()
    .withUri(uri)
    .withDatabaseName(db)
    .withToken(token || undefined)
    .withAutomaticReconnect()
    .onConnect((conn, identity, newToken) => {
      if (!token) console.log(`[${role}] new identity ${identity.toHexString()}. Save this token in .env.local:\n${newToken}`);
      conn.reducers.claimRole({ name: role }).then(
        () => resolve(conn),
        (err) => {
          conn.disconnect();
          reject(new Error(`[${role}] could not claim role: ${err}`));
        }
      );
    })
    .onConnectError((_ctx, err) => reject(new Error(`[${role}] connect failed: ${err}`)))
    .build());
}
