export const arrivalReminderTemplate = "Hello {first_name}, your shift for {show_name} is coming up.\n\n{next_call_sentence}\n\n{meet_up_section}\n\n{booth_line}\n\nPlease bring a screwdriver and crescent wrench.\n\nPlease text me here when you arrive at the meet-up location.\n\nCoordinator: {coordinator_name}\nEmanuel Labor Services";

export function reconfirmSchedule(message: string) {
  const notice = "As the show approaches, I would like to reconfirm your schedule below. Please reply confirmed.";
  if (message.includes(notice)) return message;
  if (/^Schedule:/im.test(message)) return message.replace(/^Schedule:/im, `${notice}\n\nSchedule:`);
  return message.replace(/^([^\n]+)(?:\n|$)/, `$1\n\n${notice}\n`);
}
