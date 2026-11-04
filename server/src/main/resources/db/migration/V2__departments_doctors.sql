-- Departments and doctors (with OPD timings used for appointment slots).

create table department (
  id         text primary key,
  branch_id  text not null references branch(id),
  name       text not null,
  icon       text not null default 'stethoscope',
  floor      text not null default '',
  active     boolean not null default true
);

create table doctor (
  id             text primary key,
  branch_id      text not null references branch(id),
  dept_id        text not null references department(id),
  user_id        uuid unique references app_user(id),
  name           text not null,
  qualification  text not null default '',
  experience     int not null default 0,
  fee            numeric(12,2) not null default 0,
  room           text not null default '',
  phone          text not null default '',
  email          text not null default '',
  days           text[] not null default '{Mon,Tue,Wed,Thu,Fri,Sat}',
  start_time     text not null default '09:00',
  end_time       text not null default '17:00',
  slot_min       int not null default 15,
  status         text not null default 'Available',
  reg_no         text not null default '',
  active         boolean not null default true
);
create index doctor_dept_idx on doctor (dept_id);
