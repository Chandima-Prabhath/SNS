/**
 * Bot framework entry point.
 *
 * Importing this file registers ALL bundled bot modules with the framework.
 * To add a new bot:
 *   1. Create src/lib/bot/bots/<name>.ts exporting a BotModule
 *   2. Register it here with `registerBotModule(<name>Bot)`
 *   3. Add a row in the Bot table with module=<name> (or create via UI)
 *
 * The framework auto-discovers commands and routes messages accordingly.
 */
import { registerBotModule } from './framework'
import { echoBot } from './bots/echo'
import { helpBot } from './bots/help'
import { pollBot } from './bots/poll'
import { reminderBot } from './bots/remind'
import { visualBot } from './bots/visual'

// Register all bundled bots. Order matters only for /help display.
registerBotModule(echoBot)
registerBotModule(helpBot)
registerBotModule(pollBot)
registerBotModule(reminderBot)
registerBotModule(visualBot)

export { dispatchBotUpdate, listBotModules, getBotModule } from './framework'
export type { BotModule, BotContext, BotCommand } from './framework'
