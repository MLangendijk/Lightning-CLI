/*
 * If not stated otherwise in this file or this component's LICENSE file the
 * following copyright and licenses apply:
 *
 * Copyright 2020 Metrological
 *
 * Licensed under the Apache License, Version 2.0 (the License);
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const build = require('./build')
const watch = require('watch')
const WebSocket = require('ws')
const chalk = require('chalk')
const buildHelpers = require('../helpers/build')
const path = require('path')

const settingsFileName = buildHelpers.getSettingsFileName() // Get settings file name
const regexp = new RegExp(`^(?!src|static|node_modules|${settingsFileName}|metadata.json)(.+)$`)

let wss

const initWebSocketServer = () => {
  const port = process.env.LNG_LIVE_RELOAD_PORT || 8991
  const server = new WebSocket.Server({ port })

  server.on('error', e => {
    if (e.code === 'EADDRINUSE') {
      console.log(chalk.red(chalk.underline(`Process already running on port: ${port}`)))
    }
  })

  process.on('SIGINT', () => {
    server.close()
    process.exit()
  })

  return server
}

const wrapWithSeparator = (folder) => {
  return `${path.sep}${folder}${path.sep}`
}

module.exports = (initCallback, watchCallback) => {
  let busy = false
  return new Promise((resolve, reject) =>
    watch.watchTree(
      '../',
      {
        interval: 1,
        filter(f) {
          if (f.includes( wrapWithSeparator('build'))
            || f.includes( wrapWithSeparator('dist'))
            || f.includes('.git')
            || f.includes('.bin')) {
            return false;
          }

          console.log(f);

          return true;
        }
      },
      (f, curr, prev) => {
        // prevent initiating another build when already busy
        if (busy === true) {
          return
        }
        if (typeof f == 'object' && prev === null && curr === null) {
          build(true)
            .then(() => {
              initCallback && initCallback().catch(() => process.exit())

              // if configured start WebSocket Server
              if (process.env.LNG_LIVE_RELOAD === 'true') {
                wss = initWebSocketServer()
              }
            })
            .catch(e => {
              reject(e)
            })
        } else {
          busy = true

          // pass the 'type of change' based on the file that was changes
          let change
          if (/.*src/g.test(f)) {
            change = 'src'
          }
          if (/.*static/g.test(f)) {
            change = 'static'
          }
          if (/.*metadata\.json/.test(f)) {
            change = 'metadata'
          }
          if ((new RegExp(`.*${settingsFileName}`, 'g')).test(f)) {
            change = 'settings'
          }

          build(false, change)
            .then(() => {
              busy = false
              watchCallback && watchCallback()
              // send reload signal over socket
              if (wss) {
                wss.clients.forEach(client => {
                  client.send('reload')
                })
              }
            })
            .catch(e => {
              reject(e)
            })
        }
      }
    )
  )
}
