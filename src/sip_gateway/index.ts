import { EventEmitter } from 'events';
import { Log } from '../log';

export interface SipGatewayOptions {
  provider: 'freeswitch' | 'asterisk';
  baseUrl: string;
  username?: string;
  password?: string;
  defaultCallerId?: string;
}

export interface DialOptions {
  conferenceId: string;
  phoneNumber: string;
  callerId?: string;
  metadata?: Record<string, string>;
}

export interface DialResponse {
  callId: string;
  provider: string;
}

export class SipGateway extends EventEmitter {
  private options: SipGatewayOptions;

  constructor(options: SipGatewayOptions) {
    super();
    this.options = options;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (this.options.username && this.options.password) {
      const token = Buffer.from(
        `${this.options.username}:${this.options.password}`
      ).toString('base64');
      headers.Authorization = `Basic ${token}`;
    }
    return headers;
  }

  async dial(options: DialOptions): Promise<DialResponse> {
    const body = {
      conferenceId: options.conferenceId,
      destination: options.phoneNumber,
      callerId: options.callerId || this.options.defaultCallerId,
      metadata: options.metadata ?? {}
    };
    const response = await fetch(new URL('/dial', this.options.baseUrl), {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const msg = await response.text();
      throw new Error(`Failed to start SIP call: ${response.status} ${msg}`);
    }
    const payload = (await response.json()) as DialResponse;
    this.emit('dial', payload);
    return payload;
  }

  async hangup(callId: string): Promise<void> {
    const response = await fetch(new URL(`/calls/${callId}`, this.options.baseUrl), {
      method: 'DELETE',
      headers: this.getHeaders()
    });
    if (!response.ok) {
      const msg = await response.text();
      throw new Error(`Failed to hang up call ${callId}: ${response.status} ${msg}`);
    }
    this.emit('hangup', { callId });
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(new URL('/health', this.options.baseUrl), {
        method: 'GET',
        headers: this.getHeaders()
      });
      return response.ok;
    } catch (err) {
      Log().warn('SIP gateway health check failed', err);
      return false;
    }
  }
}
