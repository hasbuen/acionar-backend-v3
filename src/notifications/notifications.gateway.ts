import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';

@WebSocketGateway({
  path: '/api/socket.io',
  cors: {
    origin: '*',
  },
})
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(private readonly jwtService: JwtService) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token || client.handshake.headers?.authorization?.split(' ')[1];
      if (!token) {
        console.log(`[SOCKET] Connection rejected: No token provided (${client.id})`);
        client.disconnect();
        return;
      }
      
      const decoded = this.jwtService.verify(token);
      client.data.user = decoded; // Store decoded user info in client instance
      
      if (decoded.tenant_slug) {
        const tenantRoom = `tenant_${decoded.tenant_slug.toLowerCase().trim()}`;
        client.join(tenantRoom);
        console.log(`[SOCKET] Authenticated client ${client.id} joined room ${tenantRoom}`);

        if (decoded.profissional_id) {
          const userRoom = `user_${decoded.profissional_id}`;
          client.join(userRoom);
          console.log(`[SOCKET] Authenticated client ${client.id} joined user room ${userRoom}`);
        }
      }
    } catch (err: any) {
      console.log(`[SOCKET] Connection rejected: Invalid token (${client.id}) - ${err.message}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    console.log(`[SOCKET] Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join-tenant')
  handleJoinTenant(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { tenantSlug: string; profissionalId: number },
  ) {
    const user = client.data.user;
    const resolvedSlug = user?.tenant_slug || data?.tenantSlug;
    if (resolvedSlug) {
      const tenantRoom = `tenant_${resolvedSlug.toLowerCase().trim()}`;
      client.join(tenantRoom);
      console.log(`[SOCKET] Client ${client.id} explicitly joined room ${tenantRoom}`);

      const resolvedProfId = user?.profissional_id || data?.profissionalId;
      if (resolvedProfId) {
        const userRoom = `user_${resolvedProfId}`;
        client.join(userRoom);
        console.log(`[SOCKET] Client ${client.id} explicitly joined user room ${userRoom}`);
      }
    }
  }

  broadcastToTenant(tenantSlug: string, event: string, payload: any) {
    const tenantRoom = `tenant_${tenantSlug.toLowerCase().trim()}`;
    if (this.server) {
      this.server.to(tenantRoom).emit(event, payload);
      console.log(`[SOCKET] Emitted ${event} to room ${tenantRoom}`);
    } else {
      console.warn('[SOCKET] Server is not initialized yet.');
    }
  }

  emitToUser(profissionalId: number, event: string, payload: any) {
    const userRoom = `user_${profissionalId}`;
    if (this.server) {
      this.server.to(userRoom).emit(event, payload);
      console.log(`[SOCKET] Emitted ${event} to user room ${userRoom}`);
    }
  }
}
