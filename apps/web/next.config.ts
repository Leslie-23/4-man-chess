import { networkInterfaces } from "node:os";
import type { NextConfig } from "next";

// Let phones and laptops on the same network load the dev server by its LAN IP.
const lanAddresses = Object.values(networkInterfaces())
  .flat()
  .flatMap((n) => (n && n.family === "IPv4" && !n.internal ? [n.address] : []));

const config: NextConfig = {
  allowedDevOrigins: lanAddresses,
};

export default config;
