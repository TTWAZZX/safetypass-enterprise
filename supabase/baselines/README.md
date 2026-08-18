# SafetyPass application schema baselines

Files in this directory are schema-only bootstrap artifacts for creating a new,
empty SafetyPass environment. They must not contain table rows, Auth users,
secrets, national IDs, or production configuration values.

`20260804180000_public_schema.sql` represents the `public` application schema
after migration `20260804180000_phase4_admin_integrity_audit`. A controlled
bootstrap must record the historical migration versions through that boundary,
then apply only later forward migrations in repository order.

Never apply this baseline over an existing project. The validation runner must
prove that the target has no SafetyPass application tables before bootstrap.
