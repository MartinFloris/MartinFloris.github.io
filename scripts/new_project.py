"""Scaffold a house-correct page for a new accession.

    python scripts/new_project.py project15-<slug>

Reads the record from projects.json and writes collections/<slug>.html with the
whole museum shell already correct — head order, canonical/OG/JSON-LD, breadcrumb,
theme toggle, favicon, properties table, medium chips — leaving one marked slot:

    <!-- ===== ARTWORK BEGINS ... ===== -->
    <!-- ===== ARTWORK ENDS ===== -->

Move the artist's markup and their local <style> into that slot. Nothing about
the shell is ever hand-written or guessed by an outside model again, which is
the entire point: every consistency bug in the Project 14 accession came from a
submission that invented the shell instead of matching it.

Refuses to overwrite an existing page.
"""
import sys

from house import COLLECTIONS, page_skeleton, projects_by_slug


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('-')]
    if len(args) != 1:
        print(__doc__.strip())
        return 2

    slug = args[0]
    if not slug.endswith('.html'):
        slug += '.html'

    records = projects_by_slug()
    record = records.get(slug)
    if not record:
        print(f'No record for {slug} in projects.json.\n\n'
              f'Add it there first — projects.json is the source of truth, and the page is\n'
              f'built from it. Known slugs:\n')
        for known in records:
            print(f'  {known}')
        return 1

    path = COLLECTIONS / slug
    if path.exists():
        print(f'{path.relative_to(COLLECTIONS.parent)} already exists — refusing to overwrite.\n'
              f'To re-stamp an existing page\'s shell instead, run:\n'
              f'  python scripts/update_collection_chrome.py\n'
              f'  python scripts/update_collection_metadata.py')
        return 1

    path.write_text(page_skeleton(record), encoding='utf-8')
    print(f'Wrote {path.relative_to(COLLECTIONS.parent)}\n')
    print('Next:')
    print('  1. Move the artist\'s markup + their local <style> into the ARTWORK slot.')
    print('  2. python scripts/generate_index.py')
    print('  3. python scripts/check_site.py')
    return 0


if __name__ == '__main__':
    sys.exit(main())
