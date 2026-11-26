# RabbitMQ Tutorials

This project contains code for [RabbitMQ tutorials](https://www.rabbitmq.com/getstarted.html) with
their ports to various languages.

This repository only contains runnable code. Please consult [tutorials on the site](https://www.rabbitmq.com/getstarted.html)
to learn more about [the concepts](https://www.rabbitmq.com/getstarted.html), requirements, supported client library version and so on.

And please check out the rest of the [RabbitMQ documentation](https://www.rabbitmq.com/documentation.html)!

## Graftcode version (this fork)

This fork converts **one** tutorial to [Graftcode](https://www.graftcode.com): the Node.js
[Tutorial six: RPC](https://www.rabbitmq.com/tutorials/tutorial-six-javascript.html) (`javascript-nodejs/src/rpc_client.js` → `rpc_server.js`).
All other tutorials and languages are unchanged and still use RabbitMQ.

In the original, the client calls `fib(n)` on the server through RabbitMQ: it opens an AMQP connection, sends the number to
`rpc_queue` with a `correlationId` and `replyTo: amq.rabbitmq.reply-to`, consumes the reply queue, matches the
correlation id and parses the string reply.
In this fork the topology stays the same, with two separate processes. The server's `fibonacci()` is hosted by
**Graftcode Gateway (`gg`)** in its own process on `ws://localhost:9090/ws`. The client calls it through a **graft**, the npm
package `@graft/npm-rabbitmq-node-tutorial` that `gg` generated from the server module:

```js
const result = (await FibonacciService.fib(num)).toString();
```

### What changed

| Side | File | Change |
| --- | --- | --- |
| Producer | `javascript-nodejs/src/fibonacci_service.js` (new) | Public `FibonacciService.fib(n)`. It calls the **unchanged** `fibonacci()` from `rpc_server.js` and prints the same ` [.] fib(n)` log line in the server process. |
| Producer | `javascript-nodejs/src/rpc_server.js` | Exports `fibonacci` and starts the AMQP consumer only when run directly (`require.main === module`). `node src/rpc_server.js` still works over RabbitMQ exactly as before. |
| Producer | `javascript-nodejs/package.json` | `main` → `./src/fibonacci_service.js` (the module `gg` hosts). New script `npm run rpc_server:graft` = `gg --runtime nodejs --modules ./package.json --port 9090 --httpPort 9091`. Graft dependency added by `npm install`. |
| Consumer | `javascript-nodejs/src/rpc_client.js` | The AMQP connection, channel, correlation id, reply-to consumer, `sendToQueue` and `generateUuid()` are replaced by one graft call. The host is set with `GraftConfig.host` and can be overridden with `RPC_SERVER_GRAFT_HOST` (default `ws://localhost:9090/ws`). `connection.close()` is replaced by `process.exit(0)` (see the notes below). |
| Repo | `javascript-nodejs/package-lock.json`, `.gitignore` | Lockfile updated by `npm install` of the graft. The `gg` runtime cache `javascript-nodejs/.graftcode/` is ignored. |

### Measured diff (vs upstream `6deb41d`, `git diff --numstat`)

| Scope | Files | Added | Removed |
| --- | --- | --- | --- |
| Consumer `rpc_client.js` (AMQP RPC client → graft call; 46 → 25 lines) | 1 | 5 | 26 |
| Producer `rpc_server.js` + `fibonacci_service.js` (new) | 2 | 24 | 1 |
| Code only (`.js`) | 3 | 29 | 27 |
| Code + `package.json` | 4 | 34 | 27 |
| Everything except this README section (adds `package-lock.json` +48, `.gitignore` +1) | 6 | 83 | 27 |
| Everything, including this README section | 7 | 173 | 27 |

### How to run it (tested with gg v1.5.1, Node.js 24.22.1, amqplib 0.10.9, RabbitMQ 4.0.5)

```bash
cd javascript-nodejs
npm install

# 1) Server: host the module with Graftcode Gateway in its own process (ws://localhost:9090/ws).
#    gg: https://github.com/grft-dev/graftcode-gateway/releases
npm run rpc_server:graft

# 2) Install the generated graft with the exact command gg prints (also served at http://localhost:9091/npm), e.g.
#    npm install --registry https://grft.dev/<GUID>__free @graft/npm-rabbitmq-node-tutorial@1.0.0
#    Without --projectKey the <GUID> changes on every gg restart, so run this against your own gg.
#    The GUID in the committed package-lock.json comes from our test run and may no longer resolve.

# 3) Client (second process)
node src/rpc_client.js 30
#  [x] Requesting fib(30)
#  [.] Got 832040
```

The RabbitMQ version still runs the original way: `node src/rpc_server.js` and the upstream `rpc_client.js`.

### Smoke test (run on 2026-11-26, 10:21:05–10:21:17 CET)

Same inputs for both runs: `n = 0, 1, 2, 10, 30, 50, 78`. Each client was a separate `node` process.

| Run | Processes | Result |
| --- | --- | --- |
| A. Upstream (RabbitMQ RPC) | RabbitMQ 4.0.5 (beam pid 23543), `rpc_server.js` pid 73871, 7 client processes (pids 73892–73968) | `Got 0, 1, 1, 55, 832040, 12586269025, 8944394323791464` |
| B. This fork (Graftcode) | `gg` pid 74056 on :9090 (hosts `fibonacci_service.js`), 7 client processes (pids 74127–74366). No `rpc_server.js` running. | The ` [x]`/` [.]` output lines were **identical to run A for all 7 inputs**. The ` [.] fib(n)` lines for all 7 calls appeared in the **gg** process log. A socket poll caught established TCP connections to :9090 from client pids 74237, 74259 and 74295 (the other calls finished between polls). `rabbitmqctl list_connections`, polled during the run, showed **0** AMQP connections, and `rpc_queue` had 0 ready and 0 unacknowledged messages before the run. |
| C. This fork, `gg` stopped | client pid 74474 | Exit code 1 after `WebSocket send to ws://localhost:9090/ws failed after 2 attempts`. There is no silent fallback. |

### Notes and limitations (measured with gg v1.5.1 and the generated graft)

- For `n >= 50` the graft returns a `BigInt` (`fib(50)` printed as `12586269025n` with `%s`). The client calls
  `.toString()` on the result, just as the original called `msg.content.toString()` on the reply, so the output is the same.
- The graft keeps its WebSocket open and has no public close method, so the client would not exit on its own. The original
  `await connection.close()` is replaced by `process.exit(0)`. `GraftConfig.stateless = true` did not change this.
- The graft prints its configuration lookup lines (`[GraftConfig] ... cannot be found`, `Adding config ...`) to stdout before the result.

### Links

- Graftcode: https://www.graftcode.com
- Message queues vs. Graftcode: https://www.graftcode.com/compare/queues
- Docs: https://docs.graftcode.com
- Expose a JavaScript backend: https://github.com/grft-dev/graftcode-quick-start-guide/blob/main/2-expose-backend/javascript.md
- Connect JavaScript microservices: https://github.com/grft-dev/graftcode-quick-start-guide/blob/main/3-connect-microservices/javascript.md
- AI-assistant rules used for this conversion: https://github.com/grft-dev/graftcode

Graftcode is free to use without an account. Only the Enterprise edition is paid.

## Prerequisites

All tutorials **require a RabbitMQ node running on localhost** with stock (default) settings.

Please refer to RabbitMQ documentation to learn
more about various [installation options](https://www.rabbitmq.com/download.html):

 * A [Windows installer](https://www.rabbitmq.com/install-windows.html)
 * A [Docker image](https://hub.docker.com/_/rabbitmq/)
 * [Homebrew](https://www.rabbitmq.com/install-homebrew.html) on MacOS
 * Packages for [Ubuntu and Debian](https://www.rabbitmq.com/install-debian.html) as well as [RPM-based distributions](https://www.rabbitmq.com/install-rpm.html) 
 * A generic [binary build](https://www.rabbitmq.com/install-generic-unix.html) for Linux, *BSD and other UNIX-like systems

## Languages

The following ports are available:

 * [C#](./dotnet)
 * [Clojure](./clojure)
 * [Common Lisp](./common-lisp)
 * [Dart](./dart)
 * [Elixir](./elixir) 
 * [Elixir (Streams)](./elixir-stream) 
 * [Erlang](./erlang)
 * [Go](./go)
 * [Haskell](./haskell)
 * [JavaScript (with Node and amqplib)](./javascript-nodejs) (using callbacks)
 * [JavaScript (with Node and amqplib)](https://github.com/amqp-node/amqplib) (using promises/futures)
 * [Java](./java) (with manual dependency management)
 * [Java with Gradle](./java-gradle)
 * [Java with Maven](./java-mvn)
 * [Kotlin](./kotlin)
 * [PHP (with php-amqplib)](./php)
 * [PHP (with php-amqp)](./php-amqp)
 * [PHP (with queue-interop)](./php-interop)
 * [Perl](./perl)
 * [Python (with Pika)](./python)
 * [Ruby (with Bunny)](./ruby)
 * [Rust with amqprs](./rust-amqprs)
 * [Rust with Lapin](./rust-lapin)
 * [Scala](./scala)
 * [Swift](./swift) (Swift 6 or later)
 * [Spring AMQP](./spring-amqp)
 * [SoapUI](./soapui)
 
## License

Released under the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0.txt).
