import { Link } from "react-router-dom";
import { BrandMark } from "../components/BrandMark.js";

type LegalPageKind = "terms" | "privacy" | "licensing" | "trademark";

interface LegalPageProps {
  kind: LegalPageKind;
}

interface LegalSection {
  title: string;
  body: string[];
  bullets?: string[];
}

interface LegalPageContent {
  title: string;
  effectiveDate: string;
  intro: string[];
  sections: LegalSection[];
}

const termsSections: LegalSection[] = [
  {
    title: "1. Service",
    body: [
      "QQueue Cloud is a hosted email delivery and campaign management platform provided by QQueue.",
      "We may update, modify, improve, or discontinue features of the service at any time.",
    ],
  },
  {
    title: "2. Accounts",
    body: [
      "You must provide accurate information when registering for the service.",
    ],
    bullets: [
      "maintaining the security of your account;",
      "keeping credentials confidential;",
      "all activity that occurs under your account.",
    ],
  },
  {
    title: "3. Acceptable Use",
    body: [
      "We may suspend or terminate accounts that violate these rules or create risk for QQueue, other customers, recipients, or third-party providers.",
    ],
    bullets: [
      "send spam or unsolicited email;",
      "distribute malware or malicious content;",
      "conduct phishing activities;",
      "violate applicable laws or regulations;",
      "interfere with service availability or security;",
      "abuse shared infrastructure;",
      "send content that infringes the rights of others.",
    ],
  },
  {
    title: "4. Billing and Payments",
    body: [
      "Certain features require a paid subscription.",
      "Fees are billed according to your selected plan.",
      "Failure to pay may result in suspension or termination of service.",
      "Unless required by law or explicitly stated in writing, payments are non-refundable.",
    ],
  },
  {
    title: "5. Service Availability",
    body: [
      "We aim to provide a reliable service but do not guarantee uninterrupted availability.",
      "Maintenance, upgrades, outages, third-party failures, DNS issues, mailbox provider filtering, blocklists, abuse events, and email infrastructure problems may affect availability or delivery.",
    ],
  },
  {
    title: "6. Email Delivery",
    body: [
      "QQueue may help customers send and manage email, but does not guarantee inbox placement, delivery to every recipient, or acceptance by mailbox providers.",
      "Customers are responsible for the lawfulness, accuracy, and permission basis of their mailing lists, contacts, templates, campaigns, transactional messages, and sender identities.",
    ],
  },
  {
    title: "7. Customer Data",
    body: [
      "You retain ownership of your content, contacts, templates, mailing lists, sender configuration, and other data submitted to the service.",
      "You grant QQueue permission to process that data solely for the purpose of providing, securing, supporting, and improving the service.",
    ],
  },
  {
    title: "8. Intellectual Property",
    body: [
      "QQueue retains all rights, title, and interest in the service, software, trademarks, branding, and related materials.",
      "These Terms do not grant ownership rights to customers.",
      "Use of QQueue source code, if any, is governed by the applicable software license.",
    ],
  },
  {
    title: "9. Termination",
    body: [
      "You may stop using the service at any time.",
      "QQueue may suspend or terminate accounts that violate these Terms, fail to pay required fees, create deliverability or abuse risks, or present security, legal, or operational risks.",
    ],
  },
  {
    title: "10. Disclaimer",
    body: [
      'The service is provided "AS IS" and "AS AVAILABLE" without warranties of any kind.',
      "We do not guarantee uninterrupted, secure, error-free, or fully deliverable operation.",
    ],
  },
  {
    title: "11. Limitation of Liability",
    body: [
      "To the maximum extent permitted by law, QQueue shall not be liable for indirect, incidental, consequential, special, exemplary, or punitive damages.",
      "Total liability shall not exceed the amount paid by the customer during the previous twelve months.",
    ],
  },
  {
    title: "12. Changes",
    body: [
      "We may update these Terms from time to time.",
      "Continued use of the service after updates constitutes acceptance of the revised Terms.",
    ],
  },
  {
    title: "13. Contact",
    body: [
      "Questions regarding these Terms may be directed to support@qqueue.app.",
    ],
  },
];

const privacySections: LegalSection[] = [
  {
    title: "1. Information We Collect",
    body: ["We do not claim ownership of customer content."],
    bullets: [
      "account information, such as name, email address, organization details, and login details;",
      "billing and subscription information;",
      "usage and analytics data;",
      "support communications;",
      "email delivery metadata required to operate the service;",
      "sender configuration, domain configuration, templates, contacts, mailing lists, and campaign information;",
      "technical data such as IP address, browser, device information, logs, and error events.",
    ],
  },
  {
    title: "2. How We Use Information",
    body: [],
    bullets: [
      "provide and maintain the service;",
      "process billing and subscriptions;",
      "authenticate users and secure accounts;",
      "improve reliability and performance;",
      "monitor deliverability and platform health;",
      "prevent abuse, spam, fraud, and misuse;",
      "provide support;",
      "communicate service, billing, security, and product updates;",
      "comply with legal obligations.",
    ],
  },
  {
    title: "3. Email Data and Delivery Metadata",
    body: [
      "Because QQueue is an email platform, we may process email-related data such as sender identities, recipient addresses, message metadata, delivery status, bounces, complaints, opens, clicks, suppression lists, and logs where applicable.",
      "We use this data to provide email delivery, analytics, abuse prevention, troubleshooting, and deliverability features.",
    ],
  },
  {
    title: "4. Data Retention",
    body: [
      "We retain information only for as long as necessary to provide the service, comply with legal obligations, resolve disputes, enforce agreements, prevent abuse, and maintain security.",
      "Customers may request deletion of account data subject to legal, security, billing, backup, and abuse-prevention requirements.",
    ],
  },
  {
    title: "5. Security",
    body: [
      "We take reasonable technical and organizational measures to protect customer information.",
      "No method of storage or transmission is completely secure, and we cannot guarantee absolute security.",
    ],
  },
  {
    title: "6. Third-Party Services",
    body: [
      "These providers may process information as necessary to perform their services.",
    ],
    bullets: [
      "hosting and infrastructure;",
      "payment processing;",
      "analytics;",
      "error monitoring;",
      "email infrastructure;",
      "customer support;",
      "security and abuse prevention.",
    ],
  },
  {
    title: "7. International Data Transfers",
    body: [
      "Your information may be processed in countries where QQueue or its service providers operate.",
      "By using QQueue, you understand that information may be transferred to and processed outside your country of residence.",
    ],
  },
  {
    title: "8. Your Rights",
    body: [
      "Depending on your jurisdiction, you may have rights relating to access, correction, deletion, restriction, objection, or portability of your personal information.",
      "Requests may be submitted to support@qqueue.app.",
    ],
  },
  {
    title: "9. Children's Privacy",
    body: [
      "QQueue is not intended for children under the age of 13, and we do not knowingly collect personal information from children.",
    ],
  },
  {
    title: "10. Changes",
    body: [
      "We may update this Privacy Policy from time to time.",
      "Updated versions will be published on qqueue.app.",
    ],
  },
  {
    title: "11. Contact",
    body: ["For privacy-related questions, contact support@qqueue.app."],
  },
];

const pages: Record<LegalPageKind, LegalPageContent> = {
  terms: {
    title: "QQueue Cloud Terms of Service",
    effectiveDate: "Draft - not yet effective",
    intro: [
      "These Terms of Service govern your access to and use of QQueue Cloud.",
      "By creating an account, accessing, or using QQueue Cloud, you agree to these Terms.",
    ],
    sections: termsSections,
  },
  privacy: {
    title: "QQueue Privacy Policy",
    effectiveDate: "Draft - not yet effective",
    intro: [
      "QQueue respects your privacy and is committed to protecting your information.",
      "This Privacy Policy explains how QQueue collects, uses, stores, and protects information when you use QQueue Cloud, qqueue.app, and related services.",
    ],
    sections: privacySections,
  },
  licensing: {
    title: "QQueue Licensing",
    effectiveDate: "Current repository summary",
    intro: [
      "QQueue is an open-core email platform built for teams that want the flexibility of self-hosting and the convenience of managed email infrastructure.",
      "The QQueue Core platform is open source and licensed under AGPL-3.0. QQueue Cloud is proprietary commercial software.",
    ],
    sections: [
      {
        title: "Open-Core Summary",
        body: [],
        bullets: [
          "QQueue Core: AGPL-3.0, self-hostable, open source.",
          "QQueue Cloud: proprietary/commercial, managed hosting and advanced operations.",
          "SDKs: MIT licensed for easy adoption where package-specific notices say so.",
          "Documentation: CC-BY-4.0 where documentation-specific notices say so.",
          "Branding: QQueue name, logo, and marks are protected by trademark terms.",
        ],
      },
    ],
  },
  trademark: {
    title: "QQueue Trademark Notice",
    effectiveDate: "Current repository summary",
    intro: [
      "QQueue, the QQueue name, logo, wordmark, branding, and related marks are trademarks of Nana Aboagye.",
      "The source code licenses in this repository do not grant permission to use QQueue branding.",
    ],
    sections: [
      {
        title: "Use of Marks",
        body: [
          "Forks, modified versions, hosted services, and redistributed versions must remove QQueue branding unless Nana Aboagye grants written permission.",
          "Descriptive references such as compatible with QQueue are allowed when they are truthful, non-misleading, and do not imply endorsement, partnership, sponsorship, or official status.",
        ],
      },
    ],
  },
};

export function LegalPage({ kind }: LegalPageProps) {
  const page = pages[kind];
  const showDraftNotice = kind === "terms" || kind === "privacy";

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8">
          <Link
            to="/"
            className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
          >
            <BrandMark className="h-7 w-7 rounded-lg" />
            QQueue
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight">
            {page.title}
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Effective Date: {page.effectiveDate}
          </p>
        </header>

        <article className="prose prose-slate max-w-none dark:prose-invert prose-headings:font-semibold prose-a:text-primary">
          {page.intro.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}

          {page.sections.map((section) => (
            <section key={section.title}>
              <h2>{section.title}</h2>
              {section.body.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              {section.bullets ? (
                <ul>
                  {section.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}

          {showDraftNotice ? (
            <section>
              <h2>Draft Legal Review Notice</h2>
              <p>
                This document is a draft and should be reviewed by a qualified
                lawyer before commercial launch.
              </p>
            </section>
          ) : null}
        </article>

        <footer className="mt-10 flex flex-wrap gap-x-4 gap-y-2 border-t pt-6 text-sm text-muted-foreground">
          <Link to="/terms" className="hover:text-foreground hover:underline">
            Terms
          </Link>
          <Link to="/privacy" className="hover:text-foreground hover:underline">
            Privacy
          </Link>
          <Link
            to="/licensing"
            className="hover:text-foreground hover:underline"
          >
            Licensing
          </Link>
          <Link
            to="/trademark"
            className="hover:text-foreground hover:underline"
          >
            Trademark
          </Link>
          <span>qqueue.app</span>
        </footer>
      </div>
    </main>
  );
}
