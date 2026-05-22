import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/queue',
})
export class QueueGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(QueueGateway.name);

  handleConnection(client: Socket) {
    this.logger.debug(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('subscribe:department')
  handleSubscribeDepartment(
    @MessageBody() data: { department_id: string },
    @ConnectedSocket() client: Socket,
  ) {
    const room = `dept:${data.department_id}`;
    client.join(room);
    client.emit('subscribed', { room });
  }

  @SubscribeMessage('subscribe:ticket')
  handleSubscribeTicket(
    @MessageBody() data: { ticket_id: string },
    @ConnectedSocket() client: Socket,
  ) {
    const room = `ticket:${data.ticket_id}`;
    client.join(room);
    client.emit('subscribed', { room });
  }

  @SubscribeMessage('unsubscribe:department')
  handleUnsubscribeDepartment(
    @MessageBody() data: { department_id: string },
    @ConnectedSocket() client: Socket,
  ) {
    client.leave(`dept:${data.department_id}`);
  }

  @SubscribeMessage('unsubscribe:ticket')
  handleUnsubscribeTicket(
    @MessageBody() data: { ticket_id: string },
    @ConnectedSocket() client: Socket,
  ) {
    client.leave(`ticket:${data.ticket_id}`);
  }

  emitTicketIssued(departmentId: string, ticket: object) {
    this.server.to(`dept:${departmentId}`).emit('queue.ticket_issued', ticket);
  }

  emitTicketCalled(departmentId: string, ticket: object) {
    this.server.to(`dept:${departmentId}`).emit('queue.ticket_called', ticket);
    this.server.to(`ticket:${(ticket as any).id}`).emit('queue.ticket_called', ticket);
  }

  emitTicketUpdated(departmentId: string, ticket: object) {
    this.server.to(`dept:${departmentId}`).emit('queue.ticket_updated', ticket);
    this.server.to(`ticket:${(ticket as any).id}`).emit('queue.ticket_updated', ticket);
  }

  emitWindowUpdated(departmentId: string, window: object) {
    this.server.to(`dept:${departmentId}`).emit('window.updated', window);
  }
}
