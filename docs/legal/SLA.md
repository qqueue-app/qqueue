# QQueue Cloud Service Level Agreement

Effective Date: Draft - not yet effective

This Service Level Agreement ("SLA") describes the availability commitment for
QQueue Cloud. It applies only to paid plans that expressly reference this SLA and
is subject to the QQueue Cloud Terms of Service.

## 1. Definitions

- **Monthly Uptime Percentage:** total minutes in a calendar month, minus minutes
  of Downtime, divided by total minutes in the month, expressed as a percentage.
- **Downtime:** sustained periods during which the core QQueue Cloud API is
  unavailable for sending and management operations, as measured by QQueue's
  monitoring, excluding Exclusions below.
- **Service Credit:** a credit applied to a future invoice, calculated as a
  percentage of the monthly fee for the affected service.

## 2. Availability Commitment

QQueue targets a Monthly Uptime Percentage of **99.9%** for the core API on
eligible paid plans.

This SLA covers platform availability. It does not cover email inbox placement or
delivery to specific recipients, which depend on mailbox providers, blocklists,
sender reputation, and customer sending practices outside QQueue's control.

## 3. Service Credits

If the Monthly Uptime Percentage falls below the target in a calendar month,
eligible customers may request Service Credits:

| Monthly Uptime Percentage | Service Credit |
| --- | --- |
| Below 99.9% but at or above 99.0% | 10% |
| Below 99.0% but at or above 95.0% | 25% |
| Below 95.0% | 50% |

Service Credits are the customer's sole and exclusive remedy for any failure to
meet this SLA.

## 4. Claiming Credits

To receive a Service Credit, the customer must submit a request to
support@qqueue.app within 30 days of the end of the affected month, including
dates, times, and supporting detail. QQueue will validate the claim against its
monitoring records.

## 5. Exclusions

This SLA does not apply to unavailability caused by:

- scheduled or emergency maintenance announced in advance where reasonably
  practicable;
- factors outside QQueue's reasonable control, including internet, DNS, and
  third-party provider failures;
- mailbox provider filtering, blocklists, or deliverability events;
- customer applications, configurations, or misuse;
- suspension or termination for violation of the Terms of Service or for abuse,
  security, or non-payment reasons;
- beta, trial, free, or preview features.

## 6. Changes

QQueue may update this SLA from time to time. Material changes will be published
on qqueue.app.

## 7. Contact

Questions about this SLA may be directed to:

support@qqueue.app

## Draft Legal Review Notice

This document is a draft and should be reviewed by a qualified lawyer before
commercial launch. Uptime targets and credit tiers must be confirmed against
operational capacity before being offered contractually.
