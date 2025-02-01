import { Context } from 'telegraf';

export interface BotContext extends Context {
  // Add any custom properties here if needed
}

export interface Message {
  text: string;
  userId: number;
  username?: string;
}

export interface CalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  start: {
    dateTime: string;
  };
  attendees?: Array<{
    email: string;
    responseStatus?: string;
  }>;
}

export interface MeetingState {
  step: 'date' | 'time' | 'email' | 'duration' | 'description' | 'confirm' | 'confirm_cancel' | 'select_cancel';
  details: {
    date: Date | null;
    time?: string;
    duration?: number;
    attendees: string[];
    description?: string;
    meetingId?: string;
    meetings?: CalendarEvent[];
  };
} 