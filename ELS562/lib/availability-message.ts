/** Remove the retired filler sentence from defaults and previously saved messages. */
export function cleanAvailabilityMessage(value: string) {
  return value
    .replace(/I have some days in between this span that I am looking to book for December\.[ \t]*/gi, "")
    .replace(/I have some days in between that range that I am booking\.[ \t]*/gi, "")
    .replace(/I have some days between those dates I[’']m looking to get filled\.[ \t]*/gi, "")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
