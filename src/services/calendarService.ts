import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { URL } from 'url';

const TOKENS_PATH = path.join(__dirname, '../../tokens.json');
const REDIRECT_URI = 'http://localhost:3000/oauth2callback';

export const oauth2Client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  REDIRECT_URI
);

export let userTokens = new Map<string, any>();

// Load existing tokens
try {
  if (fs.existsSync(TOKENS_PATH)) {
    const data = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'));
    userTokens = new Map(Object.entries(data));
  }
} catch (error) {
  console.error('Error loading tokens:', error);
}

function saveTokens() {
  try {
    const data = Object.fromEntries(userTokens);
    fs.writeFileSync(TOKENS_PATH, JSON.stringify(data));
  } catch (error) {
    console.error('Error saving tokens:', error);
  }
}

export function isUserAuthorized(userId: number): boolean {
  return userTokens.has(userId.toString());
}

export async function startAuthProcess(userId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    // Create temporary server to handle the OAuth callback
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url!, `http://${req.headers.host}`);
        const code = url.searchParams.get('code');

        if (code) {
          const { tokens } = await oauth2Client.getToken(code);
          userTokens.set(userId.toString(), tokens);
          saveTokens();

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('Authorization successful! You can close this window and return to the bot.');
          
          server.close();
        }
      } catch (error) {
        console.error('Error in OAuth callback:', error);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Authorization failed. Please try again.');
      }
    });

    server.listen(3000, () => {
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/calendar'],
        prompt: 'consent'
      });
      resolve(authUrl);
    });

    server.on('error', (error) => {
      console.error('Server error:', error);
      reject(error);
    });
  });
}

export async function listUpcomingEvents(
  userId: number, 
  days: number = 7,
  startDate?: Date,
  endDate?: Date
): Promise<CalendarEvent[]> {
  try {
    console.log('listUpcomingEvents called with:', { userId, days, startDate, endDate });
    
    const userToken = userTokens.get(userId.toString());
    if (!userToken) {
      console.error('User not authorized');
      return [];
    }

    oauth2Client.setCredentials(userToken);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Use provided dates or calculate based on days
    const timeMin = startDate ? new Date(startDate) : new Date();
    const timeMax = endDate ? new Date(endDate) : new Date(timeMin.getTime() + days * 24 * 60 * 60 * 1000);

    // Ensure we're using the full day range
    timeMin.setHours(0, 0, 0, 0);
    timeMax.setHours(23, 59, 59, 999);

    console.log('Fetching events with timeRange:', {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString()
    });

    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 100
    });

    const events = response.data.items || [];
    console.log(`Found ${events.length} events`);

    // Filter events to ensure they fall within the requested date range
    // and convert to CalendarEvent type
    const filteredEvents = events
      .filter(event => {
        if (!event.start?.dateTime && !event.start?.date) return false;
        const eventStart = new Date(event.start.dateTime || event.start.date || '');
        return eventStart >= timeMin && eventStart <= timeMax;
      })
      .map(event => ({
        id: event.id || '',
        summary: event.summary,
        description: event.description,
        start: {
          dateTime: event.start?.dateTime || event.start?.date || new Date().toISOString()
        },
        attendees: event.attendees
      })) as CalendarEvent[];

    console.log(`Filtered to ${filteredEvents.length} events within range`);

    // Sort events by start time
    return filteredEvents.sort((a, b) => {
      const aTime = new Date(a.start.dateTime).getTime();
      const bTime = new Date(b.start.dateTime).getTime();
      return aTime - bTime;
    });

  } catch (error) {
    console.error('Error listing events:', error);
    throw error;
  }
}

export async function createMeeting(
  userId: number,
  summary: string,
  description: string,
  startTime: Date,
  endTime: Date,
  attendees: string[]
): Promise<boolean> {
  try {
    const userToken = userTokens.get(userId.toString());
    if (!userToken) throw new Error('User not authorized');

    oauth2Client.setCredentials(userToken);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const event = {
      summary,
      description,
      start: {
        dateTime: startTime.toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      end: {
        dateTime: endTime.toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      attendees: attendees.map(email => ({ email })),
    };

    await calendar.events.insert({
      calendarId: 'primary',
      requestBody: event,
      sendUpdates: 'all',
    });

    return true;
  } catch (error) {
    console.error('Error creating meeting:', error);
    return false;
  }
}

interface CalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  start: {
    dateTime: string;
    date?: string;
  };
  end: {
    dateTime: string;
    date?: string;
  };
  attendees?: Array<{
    email: string;
    responseStatus?: string;
  }>;
} 