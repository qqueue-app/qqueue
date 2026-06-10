import { beforeEach, describe, expect, it, vi } from "vitest";
import { SMTPProvider } from "./smtp-provider.js";

const verify = vi.fn();
const sendMail = vi.fn();
const createTransport = vi.fn(() => ({ verify, sendMail }));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: (...args: unknown[]) => createTransport(...args)
  }
}));

const options = {
  host: "smtp.example.com",
  port: 587,
  secure: false,
  auth: { user: "user", pass: "pass" }
};

describe("SMTPProvider", () => {
  beforeEach(() => {
    verify.mockReset();
    sendMail.mockReset();
    createTransport.mockClear();
  });

  it("wires the transporter with the given options", () => {
    new SMTPProvider(options);
    expect(createTransport).toHaveBeenCalledWith(options);
  });

  it("delegates verify() to the transporter", async () => {
    verify.mockResolvedValue(true);
    const provider = new SMTPProvider(options);
    await provider.verify();
    expect(verify).toHaveBeenCalledOnce();
  });

  it("maps nodemailer info into a SendEmailResult", async () => {
    sendMail.mockResolvedValue({
      messageId: "<abc@smtp>",
      accepted: ["to@example.com"],
      rejected: []
    });
    const provider = new SMTPProvider(options);

    const result = await provider.send({
      from: "from@example.com",
      to: "to@example.com",
      subject: "Hi",
      html: "<p>Hi</p>"
    });

    expect(sendMail).toHaveBeenCalledWith({
      from: "from@example.com",
      to: "to@example.com",
      subject: "Hi",
      html: "<p>Hi</p>"
    });
    expect(result).toEqual({
      messageId: "<abc@smtp>",
      accepted: ["to@example.com"],
      rejected: [],
      provider: "smtp"
    });
  });

  it("maps accepted/rejected entries through String()", async () => {
    sendMail.mockResolvedValue({
      messageId: "<id>",
      accepted: [{ toString: () => "ok@example.com" }],
      rejected: [{ toString: () => "no@example.com" }]
    });
    const provider = new SMTPProvider(options);

    const result = await provider.send({
      from: "from@example.com",
      to: "no@example.com",
      subject: "Hi"
    });

    expect(result.accepted).toEqual(["ok@example.com"]);
    expect(result.rejected).toEqual(["no@example.com"]);
  });
});
