import { assertEquals } from "jsr:@std/assert";

async function withTempFile(fn: (path: string) => Promise<void>) {
  const tempFile = await Deno.makeTempFile();
  try {
    await fn(tempFile);
  } finally {
    try {
      await Deno.remove(tempFile);
    } catch {
      // Ignore cleanup errors
    }
  }
}

Deno.test("process single JSON object", async () => {
  await withTempFile(async (outputFile) => {
    // Start the proxy process
    const proxy = new Deno.Command("cargo", {
      args: ["run", "--bin", "proxy_json"],
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
      env: {
        PROXY_TO: "cat",
        OUTPUT_FILE: outputFile,
      },
    });

    const proxyProcess = proxy.spawn();
    const testJson = { test: "value", number: 42 };

    // Send JSON to proxy
    const writer = proxyProcess.stdin.getWriter();
    await writer.write(
      new TextEncoder().encode(JSON.stringify(testJson) + "\n"),
    );
    await writer.close();

    // Wait for completion
    const { success, stdout, stderr } = await proxyProcess.output();
    assertEquals(success, true);

    // Read and verify output file
    const content = await Deno.readTextFile(outputFile);
    assertEquals(JSON.parse(content.trim()), testJson);
  });
});

Deno.test("process multiple JSON objects", async () => {
  await withTempFile(async (outputFile) => {
    const proxy = new Deno.Command("cargo", {
      args: ["run", "--bin", "proxy_json"],
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
      env: {
        PROXY_TO: "cat",
        OUTPUT_FILE: outputFile,
      },
    });

    const proxyProcess = proxy.spawn();
    const testJsons = [
      { first: "object" },
      { second: 42 },
      { third: true },
    ];

    // Send each JSON object
    const writer = proxyProcess.stdin.getWriter();
    for (const obj of testJsons) {
      await writer.write(new TextEncoder().encode(JSON.stringify(obj) + "\n"));
    }
    await writer.close();

    // Wait for completion
    const { success } = await proxyProcess.output();
    assertEquals(success, true);

    // Read and verify output file
    const content = await Deno.readTextFile(outputFile);
    const lines = content.trim().split("\n");
    assertEquals(
      lines.map((line) => JSON.parse(line)),
      testJsons,
    );
  });
});

Deno.test("process nested JSON", async () => {
  await withTempFile(async (outputFile) => {
    const proxy = new Deno.Command("cargo", {
      args: ["run", "--bin", "proxy_json"],
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
      env: {
        PROXY_TO: "cat",
        OUTPUT_FILE: outputFile,
      },
    });

    const proxyProcess = proxy.spawn();
    const testJson = {
      nested: {
        object: { deep: true },
        array: [1, 2, 3],
      },
    };

    // Send JSON to proxy
    const writer = proxyProcess.stdin.getWriter();
    await writer.write(
      new TextEncoder().encode(JSON.stringify(testJson) + "\n"),
    );
    await writer.close();

    // Wait for completion
    const { success } = await proxyProcess.output();
    assertEquals(success, true);

    // Read and verify output file
    const content = await Deno.readTextFile(outputFile);
    const parsed = JSON.parse(content.trim());
    assertEquals(parsed, testJson);
  });
});
