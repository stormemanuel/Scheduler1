export const cancellationHeading = "********** YOUR SHIFTS ARE CANCELLED **********";
export const cancellationReply = "Please respond canceled to this cancellation.";

export function formatCancellationMessage(value: string) {
  const body = value.split(/\r?\n/)
    .filter((line) => line.trim() !== cancellationHeading)
    .filter((line) => !/^please (?:confirm this cancellation\.?|respond canceled to this cancellation\.?)$/i.test(line.trim()))
    .join("\n").trim();
  return [cancellationHeading, body, cancellationReply].filter(Boolean).join("\n\n");
}
