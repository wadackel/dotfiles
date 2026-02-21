# Additional Service Commands

## Forms

```bash
gog forms create
gog forms get <form-id>
gog forms responses <form-id>
```

## Classroom

```bash
gog classroom courses list
gog classroom rosters
gog classroom coursework
gog classroom materials
gog classroom submissions
gog classroom announcements
gog classroom topics
gog classroom invitations
gog classroom guardians
gog classroom profiles
```

## Apps Script

```bash
gog appscript projects create
gog appscript projects get <project-id>
gog appscript run <function-name>
gog appscript content <project-id>
```

## Groups (Workspace)

```bash
gog groups list
gog groups members <group-id>
```

## Keep (Workspace + Service Account required)

```bash
gog keep list
gog keep get <note-id>
gog keep search "query"
gog keep attachments <note-id>
```

Keep requires a service account configured via:
```bash
gog auth service-account set you@domain.com --key ~/Downloads/service-account.json
```
