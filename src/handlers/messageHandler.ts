import { OpenAIApi, Configuration } from 'openai';
import type { BotContext, MeetingState, CalendarEvent } from '../types';
import { REMO_PERSONALITY } from '../index';
import { 
  createMeeting, 
  isUserAuthorized, 
  startAuthProcess,
  oauth2Client,
  userTokens,
  listUpcomingEvents 
} from '../services/calendarService';
import { google } from 'googleapis';

const openai = new OpenAIApi(new Configuration({ apiKey: process.env.OPENAI_API_KEY }));

// Store conversation history
interface Conversation {
  messages: { role: 'user' | 'assistant' | 'system', content: string }[];
  lastUpdate: number;
}

const conversations = new Map<number, Conversation>();
const userMeetingStates = new Map<number, MeetingState>();

// Greeting variations
const greetings = [
  "Hey! How's it going? 😊",
  "Hi there! What's on your mind today?",
  "Hello! How can I help you today? 💫",
  "Hey! Nice to see you! What's up? 😊",
  "Hi! How's your day going so far? ✨",
  "Hello there! What can I do for you today? 🌟",
];

async function handleChat(userId: number, userMessage: string): Promise<string> {
  // Get or initialize conversation
  let conversation = conversations.get(userId);
  if (!conversation) {
    conversation = {
      messages: [{ role: 'system', content: REMO_PERSONALITY }],
      lastUpdate: Date.now()
    };
  }

  // Don't handle meeting-related messages
  if (isMeetingRequest(userMessage)) {
    return "I'll help you schedule a meeting. Please provide the details.";
  }

  // Add user message
  conversation.messages.push({ role: 'user', content: userMessage });

  // Check for repetitive messages
  const lastUserMessages = conversation.messages
    .filter(msg => msg.role === 'user')
    .map(msg => msg.content.toLowerCase());

  const repetitionCount = lastUserMessages.filter(msg => msg === userMessage.toLowerCase()).length;

  try {
    if (isGreeting(userMessage)) {
      let response;
      if (repetitionCount > 1) {
        response = getRepetitiveGreetingResponse(repetitionCount);
      } else {
        response = getRandomGreeting();
      }
      conversation.messages.push({ role: 'assistant', content: response });
      conversations.set(userId, conversation);
      return response;
    }

    // Handle repetitive "how are you" variations
    if (isHowAreYou(userMessage)) {
      let response;
      if (repetitionCount > 1) {
        response = getRepetitiveHowAreYouResponse(repetitionCount);
      } else {
        response = getRandomHowAreYouResponse();
      }
      conversation.messages.push({ role: 'assistant', content: response });
      conversations.set(userId, conversation);
      return response;
    }

    // Get AI response for other messages
    const completion = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages: [
        ...conversation.messages,
        {
          role: "system",
          content: `The user has sent similar messages ${repetitionCount} times. If repetitive, acknowledge it naturally.`
        }
      ],
      temperature: 0.7,
      presence_penalty: 0.6,
      frequency_penalty: 0.5,
    });

    const response = completion.data.choices[0]?.message?.content || 
      "I'm having trouble understanding. Could you rephrase that?";

    conversation.messages.push({ role: 'assistant', content: response });
    conversation.lastUpdate = Date.now();
    conversations.set(userId, conversation);

    return response;
  } catch (error) {
    console.error('Chat error:', error);
    return "I'm having a moment. Could you try again?";
  }
}

function isGreeting(message: string): boolean {
  const greetingPatterns = [
    /^hi\b/i,
    /^hello\b/i,
    /^hey\b/i,
    /^greetings\b/i,
    /^good\s*(morning|afternoon|evening)\b/i,
  ];
  return greetingPatterns.some(pattern => pattern.test(message.trim()));
}

function getRandomGreeting(): string {
  return greetings[Math.floor(Math.random() * greetings.length)];
}

function isHowAreYou(message: string): boolean {
  const patterns = [
    /^how are you/i,
    /^how(')?s it going/i,
    /^how do you feel/i,
    /^how(')?re you/i
  ];
  return patterns.some(pattern => pattern.test(message.trim()));
}

function getRandomHowAreYouResponse(): string {
  const responses = [
    "I'm doing great, thank you! How can I help you today? 😊",
    "I'm feeling fantastic! What can I do for you? ✨",
    "I'm wonderful, thanks for asking! How can I assist you? 🌟",
    "I'm doing well! What's on your mind? 💫",
    "I'm great! Ready to help you with whatever you need! 😊"
  ];
  return responses[Math.floor(Math.random() * responses.length)];
}

function getRepetitiveHowAreYouResponse(count: number): string {
  const responses = [
    "I see you're checking on me again! 😊 I'm still doing great and ready to help!",
    "You're very thoughtful to keep asking! I'm always here and ready to assist you. What's on your mind?",
    "I appreciate your concern! But maybe I should be asking - how are YOU doing? 😊",
    "Still doing great! Though I'm more interested in how I can help YOU right now! 🌟",
    "You seem very interested in my well-being! I'm always good, but I'd love to know what you need help with! 💫"
  ];
  
  if (count > 4) {
    return "I notice you've asked how I am several times. While I appreciate your interest, I'm always here and ready to help! Is there something specific you'd like assistance with? 😊";
  }
  
  return responses[Math.floor(Math.random() * responses.length)];
}

function getRepetitiveGreetingResponse(count: number): string {
  if (count === 2) {
    return "Hey again! 👋 Nice to see you're still here!";
  } else if (count === 3) {
    return "Hi once more! You're very friendly today! 😊";
  } else {
    return "I see you're saying hi a lot! I'm always here and happy to chat. What's on your mind? 🌟";
  }
}

// Clean up old conversations every hour
setInterval(() => {
  const now = Date.now();
  for (const [userId, conversation] of conversations.entries()) {
    if (now - conversation.lastUpdate > 3600000) { // 1 hour
      conversations.delete(userId);
    }
  }
}, 3600000);

// Training data for meeting intent recognition
const MEETING_TRAINING_DATA = [
  // Format: [user input, extracted info]
  
  // Complete requests
  ["schedule a meeting with John at 3pm", { has: ['name', 'time'] }],
  ["set up call with Sarah tomorrow 2:30pm", { has: ['name', 'time', 'date'] }],
  
  // Partial requests - missing time
  ["schedule meeting with Alex", { has: ['name'] }],
  ["book a call with team", { has: ['name'] }],
  
  // Partial requests - missing attendee
  ["schedule meeting for 3pm", { has: ['time'] }],
  ["set up call at 15:00", { has: ['time'] }],
  
  // Minimal requests
  ["schedule a meeting", { has: [] }],
  ["set up a call", { has: [] }],
  
  // Add more examples as needed...
];

function analyzeMeetingRequest(message: string): {
  hasTime: boolean;
  hasName: boolean;
  hasDate: boolean;
  hasDuration: boolean;
  hasEmail: boolean;
  extractedInfo: {
    time?: string;
    name?: string;
    date?: string;
    duration?: number;
    emails?: string[];
    description?: string;
  };
} {
  const timePattern = /(\d{1,2})(?::(\d{2}))?\s*(am|pm|AM|PM)?/;
  const namePattern = /(?:with|for)\s+([A-Za-z]+)/i;
  const datePattern = /(?:on|for|next|today|tomorrow)\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)?/i;
  const durationPattern = /(\d+)\s*(?:min|minutes?|hrs?|hours?)/i;
  const emailPattern = /[\w\.-]+@[\w\.-]+\.\w+/g;  // Global flag to find all emails
  const descPattern = /(?:with description|description:?|about|regarding)\s*["']?([^"']+)["']?/i;

  const timeMatch = message.match(timePattern);
  const nameMatch = message.match(namePattern);
  const dateMatch = message.match(datePattern);
  const durationMatch = message.match(durationPattern);
  const emailMatches = message.match(emailPattern) || [];
  const descMatch = message.match(descPattern);
  const hasToday = message.toLowerCase().includes('today');
  const noDesc = message.toLowerCase().includes('no description');

  // Convert duration to minutes
  let duration: number | undefined;
  if (durationMatch) {
    const num = parseInt(durationMatch[1]);
    const unit = durationMatch[0].toLowerCase();
    duration = unit.includes('hour') ? num * 60 : num;
  }

  return {
    hasTime: !!timeMatch,
    hasName: !!nameMatch,
    hasDate: hasToday || !!dateMatch,
    hasDuration: !!durationMatch,
    hasEmail: emailMatches.length > 0,
    extractedInfo: {
      time: timeMatch ? extractTime(timeMatch[0]) || undefined : undefined,
      name: nameMatch ? nameMatch[1] : undefined,
      date: hasToday ? 'today' : dateMatch?.[1] || undefined,
      duration,
      emails: emailMatches,
      description: noDesc ? undefined : descMatch?.[1]
    }
  };
}

async function handleMeetingRequest(ctx: BotContext, userId: number, userMessage: string): Promise<void> {
  try {
    let state = userMeetingStates.get(userId) as MeetingState | undefined;
    
    // Check for cancellation requests first
    const cancelKeywords = ['cancel', 'stop', 'no', 'quit', 'exit', 'nevermind', 'never mind'];
    if (cancelKeywords.some(keyword => userMessage.toLowerCase().includes(keyword))) {
      if (state) {
        userMeetingStates.delete(userId);
        await ctx.reply("I've cancelled the meeting scheduling. Let me know if you want to schedule another meeting!");
        return;
      }
    }
    
    if (!state) {
      const analysis = analyzeMeetingRequest(userMessage);
      state = {
        step: 'date',
        details: {
          date: null,
          time: undefined,
          duration: undefined, // Remove default duration
          attendees: [],
          description: undefined
        }
      };

      // Extract all available information from initial message
      if (analysis.extractedInfo.time) {
        state.details.time = analysis.extractedInfo.time;
      }
      if (analysis.extractedInfo.date) {
        const parsedDate = parseDateInput(analysis.extractedInfo.date);
        if (parsedDate) {
          state.details.date = parsedDate;
        }
      }
      if (analysis.extractedInfo.duration) {
        state.details.duration = analysis.extractedInfo.duration;
      }
      if (analysis.extractedInfo.emails && analysis.extractedInfo.emails.length > 0) {
        state.details.attendees = analysis.extractedInfo.emails;
      }
      if (analysis.extractedInfo.description !== undefined) {
        state.details.description = analysis.extractedInfo.description;
      }

      // If today is mentioned, set the date to today
      if (userMessage.toLowerCase().includes('today')) {
        state.details.date = new Date();
      }

      // Determine which information is missing and set next step
      if (!state.details.date) {
        state.step = 'date';
      } else if (!state.details.time) {
        state.step = 'time';
      } else if (!state.details.attendees.length) {
        state.step = 'email';
      } else if (!state.details.duration) {
        state.step = 'duration';
      } else {
        state.step = 'confirm';
      }

      let response = "I'll help you schedule a meeting. Here's what I understood:\n\n";
      if (state.details.date) response += `📅 Date: ${state.details.date.toLocaleDateString()}\n`;
      if (state.details.time) response += `⏰ Time: ${state.details.time}\n`;
      if (state.details.duration) response += `⏱️ Duration: ${state.details.duration} minutes\n`;
      if (state.details.attendees.length) response += `👥 Attendees: ${state.details.attendees.join(', ')}\n`;
      if (state.details.description) response += `📝 Description: ${state.details.description}\n`;
      
      response += "\n";

      switch (state.step) {
        case 'date':
          response += "What date would you like to schedule it for? (e.g., tomorrow, 25th March, 25-03-2024)";
          break;
        case 'time':
          response += "What time would you like to schedule it for? (e.g., 2:30 PM, 14:30)";
          break;
        case 'email':
          response += "Please provide Susmitha's email address";
          break;
        case 'duration':
          response += "How long should the meeting be? (in minutes)";
          break;
        case 'confirm':
          response = "Please confirm these meeting details:\n\n" +
            `📅 Date: ${state.details.date?.toLocaleDateString()}\n` +
            `⏰ Time: ${state.details.time}\n` +
            `⏱️ Duration: ${state.details.duration} minutes\n` +
            `👥 Attendees: ${state.details.attendees.join(', ')}\n` +
            `📝 Description: ${state.details.description || 'No description'}\n\n` +
            "Is this correct? (Yes/No)";
          break;
      }

      userMeetingStates.set(userId, state);
      await ctx.reply(response);
      return;
    }

    // Handle each step
    switch (state.step) {
      case 'date':
        const parsedDate = parseDateInput(userMessage);
        if (!parsedDate) {
          await ctx.reply(
            "I couldn't understand that date format. Please use a format like:\n" +
            "• tomorrow\n" +
            "• 25th March\n" +
            "• 25-03-2024\n" +
            "• 25/03\n" +
            "Remember, the date should be in the future.\n\n" +
            "Or type 'cancel' to stop scheduling."
          );
          return;
        }
        state.details.date = parsedDate;
        state.step = state.details.time ? 'email' : 'time';
        await ctx.reply(
          state.details.time ? 
            "Please provide the attendee's email address (or type 'cancel' to stop)" :
            "What time would you like to schedule it for? (e.g., 2:30 PM, 14:30)\n\nOr type 'cancel' to stop scheduling."
        );
        break;

      case 'time':
        const timeDetails = extractTime(userMessage);
        if (!timeDetails) {
          await ctx.reply(
            "Please provide a valid time format like:\n" +
            "• 2:30 PM\n" +
            "• 14:30\n" +
            "• 2 PM\n\n" +
            "Or type 'cancel' to stop scheduling."
          );
          return;
        }
        state.details.time = timeDetails;
        state.step = state.details.attendees.length ? 'duration' : 'email';
        await ctx.reply(
          state.details.attendees.length ?
            "How long should the meeting be? (in minutes)\n\nOr type 'cancel' to stop scheduling." :
            "Please provide the attendee's email address (or type 'cancel' to stop)"
        );
        break;

      case 'email':
        const email = validateEmail(userMessage);
        if (!email) {
          await ctx.reply(
            "Please provide a valid email address (e.g., name@domain.com)\n\n" +
            "Or type 'cancel' to stop scheduling."
          );
          return;
        }
        state.details.attendees = [email];
        state.step = state.details.duration ? 'description' : 'duration';
        await ctx.reply(
          state.details.duration ?
            "Would you like to add a description for the meeting? (Type 'skip' to skip or 'cancel' to stop)" :
            "How long should the meeting be? (in minutes)\n\nOr type 'cancel' to stop scheduling."
        );
        break;

      case 'duration':
        const duration = parseInt(userMessage);
        if (isNaN(duration) || duration <= 0 || duration > 480) {
          await ctx.reply(
            "Please provide a valid duration between 1 and 480 minutes\n\n" +
            "Or type 'cancel' to stop scheduling."
          );
          return;
        }
        state.details.duration = duration;
        state.step = 'description';
        await ctx.reply(
          "Would you like to add a description for the meeting?\n" +
          "(Type 'skip' to skip or 'cancel' to stop scheduling)"
        );
        break;

      case 'description':
        if (userMessage.toLowerCase() !== 'skip') {
          state.details.description = userMessage;
        }
        state.step = 'confirm';
        await ctx.reply(
          "Please confirm these meeting details:\n\n" +
          `📅 Date: ${state.details.date?.toLocaleDateString()}\n` +
          `⏰ Time: ${state.details.time}\n` +
          `⏱️ Duration: ${state.details.duration} minutes\n` +
          `👥 Attendees: ${state.details.attendees.join(', ')}\n` +
          `📝 Description: ${state.details.description || 'No description'}\n\n` +
          "Is this correct? (Yes/No)\n\n" +
          "Type 'cancel' to stop scheduling."
        );
        break;

      case 'confirm':
        if (userMessage.toLowerCase().includes('yes')) {
          if (!isUserAuthorized(userId)) {
            const authUrl = await startAuthProcess(userId);
            await ctx.reply(
              "I'll create the meeting, but first I need access to your calendar. " +
              "Please click this link to authorize:\n\n" +
              authUrl + "\n\n" +
              "After authorizing, come back and we'll try again."
            );
            return;
          }

          const startTime = new Date(state.details.date!);
          const [hours, minutes] = state.details.time!.split(':');
          startTime.setHours(parseInt(hours), parseInt(minutes));

          const endTime = new Date(startTime.getTime() + state.details.duration! * 60000);

          const success = await createMeeting(
            userId,
            `Meeting with ${state.details.attendees[0].split('@')[0]}`,
            state.details.description || "Meeting scheduled via Remo",
            startTime,
            endTime,
            state.details.attendees
          );

          if (success) {
            await ctx.reply(
              "✅ Meeting scheduled successfully!\n\n" +
              `📅 Date: ${startTime.toLocaleDateString()}\n` +
              `⏰ Time: ${startTime.toLocaleTimeString()}\n` +
              `⏱️ Duration: ${state.details.duration} minutes\n` +
              `👥 Attendees: ${state.details.attendees.join(', ')}\n` +
              `📝 Description: ${state.details.description || 'No description'}\n\n` +
              "Calendar invite has been sent to all attendees."
            );
          } else {
            await ctx.reply("Sorry, I couldn't schedule the meeting. Please check your calendar permissions and try again.");
          }
          userMeetingStates.delete(userId);
        } else if (!cancelKeywords.includes(userMessage.toLowerCase())) {
          await ctx.reply("No problem, let's start over. Just tell me when you want to schedule a meeting.");
          userMeetingStates.delete(userId);
        }
        break;
    }

    userMeetingStates.set(userId, state);
  } catch (error) {
    console.error('Error in meeting scheduling:', error);
    await ctx.reply("I encountered an error. Let's start over with the scheduling.");
    userMeetingStates.delete(userId);
  }
}

// Add these time and date mappings
const TIME_EXPRESSIONS: { [key: string]: string } = {
  'noon': '12:00',
  'midnight': '00:00',
  'midday': '12:00',
  'morning': '09:00',
  'afternoon': '14:00',
  'evening': '18:00',
  'night': '20:00',
  'dawn': '06:00',
  'dusk': '18:00',
  'lunch': '12:00',
  'breakfast': '08:00',
  'dinner': '19:00',
  'brunch': '10:30',
  'eod': '17:00',      // End of day
  'cob': '17:00',      // Close of business
  'early morning': '07:00',
  'late night': '23:00'
};

const DATE_EXPRESSIONS: { [key: string]: (baseDate: Date) => Date } = {
  'today': (date) => date,
  'tomorrow': (date) => new Date(date.setDate(date.getDate() + 1)),
  'day after tomorrow': (date) => new Date(date.setDate(date.getDate() + 2)),
  'next week': (date) => new Date(date.setDate(date.getDate() + 7)),
  'weekend': (date) => {
    const daysToWeekend = 6 - date.getDay(); // Saturday
    return new Date(date.setDate(date.getDate() + daysToWeekend));
  },
  'month end': (date) => {
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    return lastDay;
  },
  'next month': (date) => new Date(date.setMonth(date.getMonth() + 1)),
  'christmas': (date) => new Date(date.getFullYear(), 11, 25), // December 25
  'new year': (date) => new Date(date.getFullYear() + 1, 0, 1), // January 1
};

function extractTime(message: string): string | null {
  const lowerMessage = message.toLowerCase();

  // Check for common expressions first
  for (const [expr, time] of Object.entries(TIME_EXPRESSIONS)) {
    if (lowerMessage.includes(expr)) {
      return time;
    }
  }

  // Regular time patterns
  const patterns = [
    /(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i,  // 3pm, 3:30pm, 3 a.m.
    /(\d{1,2})[.:](\d{2})/,                               // 15.30, 15:30
    /(\d{1,2})\s*o['']\s*clock/i,                         // 3 o'clock
    /(\d{1,2})\s*hrs/i,                                   // 15 hrs
    /at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i            // at 3pm, at 15:00
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      let hours = parseInt(match[1]);
      const minutes = match[2] ? parseInt(match[2]) : 0;
      const meridian = match[3]?.toLowerCase();

      if (meridian?.includes('p') && hours < 12) hours += 12;
      if (meridian?.includes('a') && hours === 12) hours = 0;
      if (!meridian && hours < 12 && (lowerMessage.includes('evening') || lowerMessage.includes('night'))) hours += 12;

      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    }
  }

  return null;
}

function parseDateInput(input: string): Date | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const lowerInput = input.toLowerCase();

  // Handle common expressions
  for (const [expr, getDate] of Object.entries(DATE_EXPRESSIONS)) {
    if (lowerInput.includes(expr)) {
      return getDate(new Date());
    }
  }

  // Handle formats like "dd-mm", "dd-mm-yyyy", "dd/mm", "dd/mm/yyyy"
  const numericDatePattern = /^(\d{1,2})[-\/](\d{1,2})(?:[-\/](\d{4}))?$/;
  const numericMatch = lowerInput.match(numericDatePattern);
  if (numericMatch) {
    const day = parseInt(numericMatch[1]);
    const month = parseInt(numericMatch[2]) - 1;
    const year = numericMatch[3] ? parseInt(numericMatch[3]) : today.getFullYear();
    const date = new Date(year, month, day);
    return isValidFutureDate(date) ? date : null;
  }

  // Handle formats like "2 feb", "second feb 2024", "2nd february", etc.
  const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const dayNumbers: { [key: string]: number } = {
    'first': 1, 'second': 2, 'third': 3, 'fourth': 4, 'fifth': 5, 'sixth': 6, 'seventh': 7, 'eighth': 8, 'ninth': 9, 'tenth': 10,
    'eleventh': 11, 'twelfth': 12, 'thirteenth': 13, 'fourteenth': 14, 'fifteenth': 15, 'sixteenth': 16, 'seventeenth': 17,
    'eighteenth': 18, 'nineteenth': 19, 'twentieth': 20, 'twenty-first': 21, 'twenty-second': 22, 'twenty-third': 23,
    'twenty-fourth': 24, 'twenty-fifth': 25, 'twenty-sixth': 26, 'twenty-seventh': 27, 'twenty-eighth': 28, 'twenty-ninth': 29,
    'thirtieth': 30, 'thirty-first': 31
  };

  for (const monthName of monthNames) {
    // Match patterns like "2 feb" or "2nd feb"
    const pattern1 = new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s+${monthName.slice(0, 3)}\\w*(?:\\s+(\\d{4}))?`, 'i');
    const match1 = lowerInput.match(pattern1);
    if (match1) {
      const day = parseInt(match1[1]);
      const month = monthNames.indexOf(monthName);
      const year = match1[2] ? parseInt(match1[2]) : today.getFullYear();
      const date = new Date(year, month, day);
      return isValidFutureDate(date) ? date : null;
    }

    // Match patterns like "second february"
    for (const [dayWord, dayNum] of Object.entries(dayNumbers)) {
      const pattern2 = new RegExp(`${dayWord}\\s+${monthName}(?:\\s+(\\d{4}))?`, 'i');
      const match2 = lowerInput.match(pattern2);
      if (match2) {
        const year = match2[1] ? parseInt(match2[1]) : today.getFullYear();
        const date = new Date(year, monthNames.indexOf(monthName), dayNum);
        return isValidFutureDate(date) ? date : null;
      }
    }
  }

  // Try parsing as direct date
  const directDate = new Date(input);
  if (!isNaN(directDate.getTime()) && isValidFutureDate(directDate)) {
    return directDate;
  }

  return null;
}

function isValidFutureDate(date: Date): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date >= today;
}

function validateEmail(email: string): string | null {
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email) ? email : null;
}

function determineMeetingAction(message: string): 'create' | 'update' | 'reschedule' | 'cancel' {
  const lowerMessage = message.toLowerCase();
  if (lowerMessage.includes('reschedule') || lowerMessage.includes('move')) return 'reschedule';
  if (lowerMessage.includes('update') || lowerMessage.includes('change')) return 'update';
  if (lowerMessage.includes('cancel') || lowerMessage.includes('delete')) return 'cancel';
  return 'create';
}

// Add these helper functions
async function updateMeeting(userId: number, meetingId: string, updates: {
  summary?: string;
  description?: string;
  attendees?: string[];
  startTime?: Date;
  endTime?: Date;
}): Promise<boolean> {
  try {
    const userToken = userTokens.get(userId.toString());
    if (!userToken) return false;

    oauth2Client.setCredentials(userToken);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Get existing event
    const event = await calendar.events.get({
      calendarId: 'primary',
      eventId: meetingId
    });

    // Update with new details
    await calendar.events.patch({
      calendarId: 'primary',
      eventId: meetingId,
      requestBody: {
        ...event.data,
        summary: updates.summary || event.data.summary,
        description: updates.description || event.data.description,
        attendees: updates.attendees?.map(email => ({ email })) || event.data.attendees,
        start: updates.startTime ? {
          dateTime: updates.startTime.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
        } : event.data.start,
        end: updates.endTime ? {
          dateTime: updates.endTime.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
        } : event.data.end
      },
      sendUpdates: 'all'
    });

    return true;
  } catch (error) {
    console.error('Error updating meeting:', error);
    return false;
  }
}

async function rescheduleMeeting(userId: number, meetingId: string, newTime: Date): Promise<boolean> {
  try {
    const userToken = userTokens.get(userId.toString());
    if (!userToken) return false;

    oauth2Client.setCredentials(userToken);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Get existing event
    const event = await calendar.events.get({
      calendarId: 'primary',
      eventId: meetingId
    });

    // Calculate new end time maintaining same duration
    const oldStart = new Date(event.data.start?.dateTime || '');
    const oldEnd = new Date(event.data.end?.dateTime || '');
    const duration = oldEnd.getTime() - oldStart.getTime();
    const newEndTime = new Date(newTime.getTime() + duration);

    // Update event time
    await calendar.events.patch({
      calendarId: 'primary',
      eventId: meetingId,
      requestBody: {
        start: {
          dateTime: newTime.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
        },
        end: {
          dateTime: newEndTime.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
        }
      },
      sendUpdates: 'all'
    });

    return true;
  } catch (error) {
    console.error('Error rescheduling meeting:', error);
    return false;
  }
}

async function cancelMeeting(userId: number, meetingId: string): Promise<boolean> {
  try {
    const userToken = userTokens.get(userId.toString());
    if (!userToken) return false;

    oauth2Client.setCredentials(userToken);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    await calendar.events.delete({
      calendarId: 'primary',
      eventId: meetingId,
      sendUpdates: 'all'
    });

    return true;
  } catch (error) {
    console.error('Error canceling meeting:', error);
    return false;
  }
}

interface UpdateMeetingState {
  step: 'find_meeting' | 'new_time' | 'new_date' | 'new_description' | 'confirm';
  action: 'update' | 'reschedule' | 'cancel';
  details: {
    meetingId?: string;
    newTime?: string;
    newDate?: Date;
    newDescription?: string;
    currentMeeting?: any;
  };
}

async function handleUpdateRequest(ctx: BotContext, userId: number, userMessage: string): Promise<void> {
  try {
    const meetings = await listUpcomingEvents(userId, 1);
    
    if (meetings.length === 0) {
      await ctx.reply("I couldn't find any meetings scheduled for today.");
      return;
    }

    // Extract time from request if present
    const timeMatch = userMessage.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
    const newTime = timeMatch ? extractTime(timeMatch[0]) : null;

    // Find the meeting with Susmitha (or mentioned attendee)
    const meeting = meetings.find((m: CalendarEvent) => 
      m.attendees?.some((a: { email: string }) => a.email.toLowerCase().includes('susmitha')) ||
      m.summary?.toLowerCase().includes('susmitha')
    );

    if (!meeting) {
      await ctx.reply("I couldn't find a meeting with that person today.");
      return;
    }

    // Handle different update types
    if (userMessage.toLowerCase().includes('cancel')) {
      const success = await cancelMeeting(userId, meeting.id);
      if (success) {
        await ctx.reply("✅ Meeting has been cancelled and attendees have been notified.");
      } else {
        await ctx.reply("❌ Sorry, I couldn't cancel the meeting. Please try again.");
      }
    } else if (newTime) {
      // Update meeting time
      const currentDate = new Date(meeting.start.dateTime);
      const [hours, minutes] = newTime.split(':');
      const newDateTime = new Date(currentDate);
      newDateTime.setHours(parseInt(hours), parseInt(minutes));

      const success = await rescheduleMeeting(userId, meeting.id, newDateTime);
      if (success) {
        await ctx.reply(
          "✅ Meeting time updated successfully!\n\n" +
          `New time: ${newDateTime.toLocaleTimeString()}\n` +
          "All attendees have been notified."
        );
      } else {
        await ctx.reply("❌ Sorry, I couldn't update the meeting time. Please try again.");
      }
    } else {
      await ctx.reply(
        "What would you like to update?\n" +
        "• Say a new time (e.g., 'move to 2:30 PM')\n" +
        "• Say 'cancel' to cancel the meeting\n" +
        "• Say 'description' to update the description"
      );
    }
  } catch (error) {
    console.error('Error updating meeting:', error);
    await ctx.reply("Sorry, I encountered an error while updating the meeting.");
  }
}

// Add this new function
async function handleCancelRequest(ctx: BotContext, userId: number, userMessage: string): Promise<void> {
  try {
    if (!isUserAuthorized(userId)) {
      const authUrl = await startAuthProcess(userId);
      await ctx.reply(
        "I need access to your calendar first. Please click this link to authorize:\n\n" +
        authUrl + "\n\n" +
        "After authorizing, come back and try again."
      );
      return;
    }

    // Extract date from message to find meetings to cancel
    const today = new Date();
    let targetDate = today;

    if (userMessage.toLowerCase().includes('tomorrow')) {
      targetDate = new Date(today);
      targetDate.setDate(today.getDate() + 1);
    } else if (userMessage.includes('today')) {
      targetDate = today;
    }

    // Set time range for the target date
    targetDate.setHours(0, 0, 0, 0);
    const endDate = new Date(targetDate);
    endDate.setHours(23, 59, 59, 999);

    // Get meetings for the target date
    const meetings = await listUpcomingEvents(userId, 1, targetDate, endDate);

    if (!meetings || meetings.length === 0) {
      await ctx.reply(`No meetings found for ${targetDate.toLocaleDateString()}! 📅`);
      return;
    }

    // If there's only one meeting, ask for confirmation to cancel it
    if (meetings.length === 1) {
      const meeting = meetings[0];
      const startTime = new Date(meeting.start.dateTime);
      await ctx.reply(
        `I found this meeting:\n\n` +
        `📅 Date: ${startTime.toLocaleDateString()}\n` +
        `⏰ Time: ${startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}\n` +
        `📌 ${meeting.summary || 'Untitled Meeting'}\n` +
        (meeting.attendees?.length ? `👥 With: ${meeting.attendees.map(a => a.email).join(', ')}\n` : '') +
        `\nWould you like me to cancel this meeting? (Yes/No)`
      );
      // Store the meeting ID for cancellation
      userMeetingStates.set(userId, {
        step: 'confirm_cancel',
        details: {
          date: targetDate,
          meetingId: meeting.id,
          time: startTime.toLocaleTimeString(),
          attendees: meeting.attendees?.map(a => a.email) || [],
          description: meeting.description
        }
      });
    } else {
      // If there are multiple meetings, list them and ask which one to cancel
      let response = `I found ${meetings.length} meetings for ${targetDate.toLocaleDateString()}. Which one would you like to cancel?\n\n`;
      
      meetings.forEach((meeting, index) => {
        const startTime = new Date(meeting.start.dateTime);
        response += `${index + 1}. ⏰ ${startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${meeting.summary || 'Untitled Meeting'}\n`;
      });
      
      response += '\nPlease reply with the number of the meeting you want to cancel.';
      
      await ctx.reply(response);
      
      // Store the meetings for selection
      userMeetingStates.set(userId, {
        step: 'select_cancel',
        details: {
          date: targetDate,
          meetings: meetings,
          time: undefined,
          attendees: [],
          description: undefined
        }
      });
    }
  } catch (error) {
    console.error('Error in handleCancelRequest:', error);
    await ctx.reply("❌ Error processing cancellation request. Please try again.");
  }
}

// Update the handleMessage function
export async function handleMessage(ctx: BotContext) {
  if (!ctx.message || !('text' in ctx.message)) return;

  const userId = ctx.from?.id;
  if (!userId) return;

  const userMessage = ctx.message.text.trim();
  
  try {
    const state = userMeetingStates.get(userId);

    // First, check if this is a meeting request or if we're in the middle of scheduling
    if (isMeetingRequest(userMessage) || state) {
      await handleMeetingRequest(ctx, userId, userMessage);
      return;
    }

    // Check for cancellation requests
    if (userMessage.toLowerCase().match(/\b(cancel|delete)\b.*\b(meeting|appointment)\b/)) {
      await handleCancelRequest(ctx, userId, userMessage);
      return;
    }

    // Check for list/view requests
    if (userMessage.toLowerCase().match(/\b(check|list|show|view|get)\b.*\b(meetings|schedule|calendar)\b/)) {
      await handleListMeetingsRequest(ctx, userId);
      return;
    }

    // Check for update/reschedule requests
    if (userMessage.toLowerCase().match(/\b(update|change|move|postpone|reschedule)\b/)) {
      await handleUpdateRequest(ctx, userId, userMessage);
      return;
    }

    // If none of the above, handle as chat
    const response = await handleChat(userId, userMessage);
    await ctx.reply(response);

  } catch (error) {
    console.error('Error:', error);
    await ctx.reply("I encountered an error. Let me know if you'd like to try again!");
  }
}

function isMeetingRequest(message: string): boolean {
  const meetingKeywords = [
    /\b(schedule|set\s*up|book|arrange|plan)\b/i,
    /\b(update|change|modify)\b/i,
    /\b(reschedule|move|postpone)\b/i,
    /\b(cancel|delete)\b/i,
    /\bmeeting\b/i,
    /\bcall\b/i,
    /\bappointment\b/i,
  ];
  return meetingKeywords.some(pattern => pattern.test(message));
}

// Add a cleanup function to remove stale conversations
setInterval(() => {
  const now = Date.now();
  for (const [userId, conversation] of conversations.entries()) {
    if (now - conversation.lastUpdate > 5 * 60 * 1000) { // 5 minutes timeout
      conversations.delete(userId);
    }
  }
}, 60 * 1000); // Check every minute 

function getWeekdayDate(weekday: string, qualifier: string = ''): Date | null {
  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const today = new Date();
  const targetDay = weekdays.indexOf(weekday.toLowerCase());
  
  if (targetDay === -1) return null;
  
  const currentDay = today.getDay();
  let daysToAdd = 0;
  
  switch (qualifier.toLowerCase()) {
    case 'next':
      daysToAdd = targetDay - currentDay + 7;
      break;
    case 'this':
      daysToAdd = targetDay - currentDay;
      if (daysToAdd <= 0) daysToAdd += 7;
      break;
    case 'coming':
      daysToAdd = targetDay - currentDay;
      if (daysToAdd <= 0) daysToAdd += 7;
      break;
    case 'last':
      // Get the last occurrence of this weekday in the current month
      const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      const lastDayWeekday = lastDay.getDay();
      daysToAdd = targetDay - lastDayWeekday;
      if (daysToAdd > 0) daysToAdd -= 7;
      return new Date(lastDay.setDate(lastDay.getDate() + daysToAdd));
    default:
      daysToAdd = targetDay - currentDay;
      if (daysToAdd <= 0) daysToAdd += 7;
  }
  
  return new Date(today.setDate(today.getDate() + daysToAdd));
}

async function handleListMeetingsRequest(ctx: BotContext, userId: number): Promise<void> {
  try {
    if (!isUserAuthorized(userId)) {
      const authUrl = await startAuthProcess(userId);
      await ctx.reply(
        "I need access to your calendar first. Please click this link to authorize:\n\n" +
        authUrl + "\n\n" +
        "After authorizing, come back and try again."
      );
      return;
    }

    const message = ctx.message && 'text' in ctx.message ? ctx.message.text.toLowerCase() : '';
    console.log('Processing list meetings request:', message);

    let startDate = new Date();
    let endDate = new Date();
    let days = 1;

    // Handle specific date formats
    if (message.includes('3rd') || message.includes('2nd') || message.includes('1st') || 
        message.match(/\d{1,2}(?:st|nd|rd|th)/) || message.match(/\d{1,2}[-\/]\d{1,2}/)) {
      const parsedDate = parseDateInput(message);
      if (parsedDate) {
        console.log('Found specific date:', parsedDate);
        startDate = parsedDate;
        endDate = new Date(parsedDate);
      }
    }
    // Handle relative dates
    else if (message.includes('tomorrow')) {
      startDate.setDate(startDate.getDate() + 1);
      endDate = new Date(startDate);
    }
    else if (message.includes('day after tomorrow')) {
      startDate.setDate(startDate.getDate() + 2);
      endDate = new Date(startDate);
    }
    else if (message.includes('this week')) {
      endDate.setDate(endDate.getDate() + (7 - endDate.getDay()));
      days = 7;
    }
    else if (message.includes('next week')) {
      startDate.setDate(startDate.getDate() + (7 - startDate.getDay()) + 1);
      endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 6);
      days = 7;
    }
    // Handle weekday patterns (next friday, last friday, etc.)
    else if (message.match(/(next|last|this)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i)) {
      const match = message.match(/(next|last|this)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i);
      if (match) {
        const weekdayDate = getWeekdayDate(match[2], match[1]);
        if (weekdayDate) {
          startDate = weekdayDate;
          endDate = new Date(weekdayDate);
        }
      }
    }

    // Set time ranges for the day
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);

    console.log('Fetching meetings for date range:', {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString()
    });

    const meetings = await listUpcomingEvents(userId, days, startDate, endDate);
    console.log('Found meetings:', meetings?.length || 0);

    if (!meetings || meetings.length === 0) {
      await ctx.reply(`No meetings found for ${startDate.toLocaleDateString()}${startDate < endDate ? ` to ${endDate.toLocaleDateString()}` : ''}! 📅`);
      return;
    }

    // Group meetings by date
    const meetingsByDate = new Map<string, typeof meetings>();
    meetings.forEach(meeting => {
      const date = new Date(meeting.start.dateTime).toLocaleDateString();
      if (!meetingsByDate.has(date)) {
        meetingsByDate.set(date, []);
      }
      meetingsByDate.get(date)?.push(meeting);
    });

    // Send meetings grouped by date
    for (const [date, dayMeetings] of meetingsByDate) {
      let response = `📅 ${date}\n\n`;
      
      for (const meeting of dayMeetings) {
        const startTime = new Date(meeting.start.dateTime);
        response += `⏰ ${startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}\n`;
        response += `📌 ${meeting.summary || 'Untitled Meeting'}\n`;
        if (meeting.attendees?.length) {
          response += `👥 With: ${meeting.attendees.map(a => a.email).join(', ')}\n`;
        }
        response += '\n';
      }

      await ctx.reply(response.trim());
    }

  } catch (error) {
    console.error('Error in handleListMeetingsRequest:', error);
    await ctx.reply("❌ Error fetching meetings. Please try again.");
  }
}

function getMonthNumber(monthStr: string): number {
  const months: { [key: string]: number } = {
    'jan': 0, 'january': 0,
    'feb': 1, 'february': 1,
    'mar': 2, 'march': 2,
    'apr': 3, 'april': 3,
    'may': 4,
    'jun': 5, 'june': 5,
    'jul': 6, 'july': 6,
    'aug': 7, 'august': 7,
    'sep': 8, 'september': 8,
    'oct': 9, 'october': 9,
    'nov': 10, 'november': 10,
    'dec': 11, 'december': 11
  };
  return months[monthStr.toLowerCase()] || 0;
}

function getNextOccurrenceOfDate(day: number, month: number): Date {
  const today = new Date();
  let year = today.getFullYear();
  
  // Create the date for this year
  let date = new Date(year, month, day);
  
  // If the date has passed, try next year
  if (date < today) {
    date = new Date(year + 1, month, day);
  }
  
  return date;
} 