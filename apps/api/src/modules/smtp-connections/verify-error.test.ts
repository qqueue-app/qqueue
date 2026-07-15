import { describe, expect, it } from "vitest";
import { describeSmtpVerifyError } from "./verify-error.js";

// Fixtures mirror real nodemailer errors: its _formatError overwrites `code`
// with a nodemailer type while the original Node/OpenSSL text stays in the
// message.
function nodemailerError(message: string, code?: string) {
  const error = new Error(message);
  if (code) {
    (error as Error & { code?: string }).code = code;
  }
  return error;
}

const host = "smtp.example.com";

describe("describeSmtpVerifyError", () => {
  it("explains implicit TLS against a STARTTLS port and keeps the raw detail", () => {
    const raw =
      "0022FB0A02000000:error:0A00010B:SSL routines:ssl3_get_record:wrong version number:../deps/openssl/openssl/ssl/record/ssl3_record.c:355:";
    const result = describeSmtpVerifyError(nodemailerError(raw, "ESOCKET"), {
      host,
      port: 587,
      secure: true
    });

    expect(result).toContain('Turn off "Secure TLS"');
    expect(result).toContain("port 587");
    expect(result).toContain(raw);
  });

  it("suggests enabling Secure TLS for a greeting timeout on port 465", () => {
    const result = describeSmtpVerifyError(
      nodemailerError("Greeting never received", "ETIMEDOUT"),
      { host, port: 465, secure: false }
    );

    expect(result).toContain('Turn on "Secure TLS"');
  });

  it("treats a greeting timeout on other ports as a generic timeout", () => {
    const result = describeSmtpVerifyError(
      nodemailerError("Greeting never received", "ETIMEDOUT"),
      { host, port: 587, secure: false }
    );

    expect(result).toContain("timed out");
    expect(result).not.toContain('Turn on "Secure TLS"');
  });

  it("maps the codeless connection-closed error on port 465", () => {
    const result = describeSmtpVerifyError(new Error("Connection closed"), {
      host,
      port: 465,
      secure: false
    });

    expect(result).toContain('Turn on "Secure TLS"');
  });

  it("points at firewalls when the connection closes on other ports", () => {
    const result = describeSmtpVerifyError(new Error("Connection closed"), {
      host,
      port: 587,
      secure: false
    });

    expect(result).toContain("firewall or security software");
    expect(result).toContain("port 465");
  });

  it("maps refused connections with the host and port", () => {
    const result = describeSmtpVerifyError(
      nodemailerError("connect ECONNREFUSED 127.0.0.1:2525", "ESOCKET"),
      { host, port: 2525, secure: false }
    );

    expect(result).toContain("connection was refused");
    expect(result).toContain("smtp.example.com:2525");
  });

  it("maps DNS failures to a host-name hint", () => {
    const result = describeSmtpVerifyError(
      nodemailerError("getaddrinfo ENOTFOUND smtp.bad.example", "EDNS"),
      { host: "smtp.bad.example", port: 587, secure: false }
    );

    expect(result).toContain('find a server named "smtp.bad.example"');
  });

  it("maps rejected credentials", () => {
    for (const message of [
      "Invalid login: 535 5.7.8 Error: authentication failed",
      'Missing credentials for "PLAIN"'
    ]) {
      const result = describeSmtpVerifyError(
        nodemailerError(message, "EAUTH"),
        { host, port: 587, secure: false }
      );
      expect(result).toContain("rejected the username or password");
    }
  });

  it("maps untrusted certificates from both TLS paths", () => {
    for (const [message, code] of [
      ["self-signed certificate", "ESOCKET"],
      ["Error initiating TLS - self signed certificate", "ETLS"],
      ["certificate has expired", "ESOCKET"],
      [
        "Hostname/IP does not match certificate's altnames: Host: x. is not cert's CN",
        "ESOCKET"
      ]
    ] as const) {
      const result = describeSmtpVerifyError(nodemailerError(message, code), {
        host,
        port: 465,
        secure: true
      });
      expect(result).toContain("security certificate isn't trusted");
    }
  });

  it("maps other STARTTLS failures to a handshake hint", () => {
    const result = describeSmtpVerifyError(
      nodemailerError("Error upgrading connection with STARTTLS", "ETLS"),
      { host, port: 587, secure: false }
    );

    expect(result).toContain("secure handshake");
  });

  it("falls back to the raw passthrough for unrecognized errors", () => {
    expect(
      describeSmtpVerifyError(new Error("connection refused"), {
        host,
        port: 587,
        secure: false
      })
    ).toBe("SMTP verification failed: connection refused");

    expect(
      describeSmtpVerifyError("nope", { host, port: 587, secure: false })
    ).toBe("SMTP verification failed");
  });
});
