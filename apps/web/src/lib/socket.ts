import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@acg-codenames/shared";

let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

export function getSocket(): Socket<ServerToClientEvents, ClientToServerEvents> {
  if (!socket) {
    socket = io(import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001", {
      autoConnect: true
    });
  }
  return socket;
}
