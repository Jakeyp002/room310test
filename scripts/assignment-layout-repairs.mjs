// Reviewed repairs for diagrams and starter outlines whose exported tab stops
// cannot be recovered safely with a general indentation rule.
export const box = [
  "=============================",
  "|                           |",
  "|    Knowledge is Power     |",
  "|                           |",
  "============================="
].join("\n");

export const initials = [
  "JJJJJJJJJJJJJJJ", "JJJJJJJJJJJJJJJ", "          JJJJ",
  "          JJJJ", "          JJJJ", "JJ        JJJJ",
  "JJ        JJJJ", " JJJJJJJJJJJ", "  JJJJJJJJJ"
].map((row, index) => row.padEnd(17) + (index < 7 ? "LLLL" : "LLLLLLLLLLLLLL")).join("\n");

export function repairLayout(source, language) {
  if (source.startsWith("=============================") && source.includes("Knowledge is Power")) return box;
  if (source.startsWith("JJJJJJJJJJJJJJJ")) return initials;
  if (language === "python" && source.includes("def hello(name):") && source.includes("# define the function")) return `########################################
## Program title, author, date and description
########################################
# Define the function (don't forget the colon at the end):
def hello(name):
    # Indent the body of the function that prints to the screen.

# Leave a blank line once the function body is complete.
# Call the function using "Sally" as the argument.`;
  if (language === "python" && source.includes("first_batch1 = 6")) return source.split("\n").map(line => line.trimStart()).join("\n");
  if (language === "python" && source.includes("for row in ########:")) return `for row in ########:        # Fill in the blank: keeps count of the row number.
    for stars in ########:  # Hint: related to the row number.
        print('*', end = ' ')  # Prints without going to a new line.
    # You need a fourth line to make this work.`;
  return source;
}

export const gameFiles = [
  { label: "Game1.py", source: `def Game1():
    print("this is game #1!")` },
  { label: "Game2.py", source: `def Game2():
    print("this is game #2!")` },
  { label: "PlayGames.py", source: `import Game1, Game2

choice = input('Would you like to play game #1 or game #2? ')
if choice == 1:
    Game1.Game1()
else:
    Game2.Game2()` }
];
