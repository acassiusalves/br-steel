-- Pilot accounts start disabled. Provision passwords/expiry separately outside migration history.
begin;
create role brsteel_pilot_reader nologin inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 2;
create role brsteel_pilot_importer nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 2;
grant brsteel_ops_reader to brsteel_pilot_reader;
grant brsteel_ops_importer to brsteel_pilot_importer;
alter role brsteel_pilot_reader set default_transaction_read_only = on;
alter role brsteel_pilot_reader set statement_timeout = '30s';
alter role brsteel_pilot_reader set idle_in_transaction_session_timeout = '30s';
alter role brsteel_pilot_importer set statement_timeout = '30s';
alter role brsteel_pilot_importer set idle_in_transaction_session_timeout = '60s';
commit;
