/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    user: {
      id: number;
      discordId: string;
      name: string;
      image: string | null;
      isAdmin: boolean;
      discordRoles: string[];
    } | null;
  }
}
