/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    user: {
      id: number;
      discordId: string;
      name: string;
      image: string | null;
      /** true if they can see any admin section at all */
      isAdmin: boolean;
      isOwner: boolean;
      perms: import("./lib/perms").Perms;
    } | null;
  }
}
